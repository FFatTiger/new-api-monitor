import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SubscriptionBillingFilters } from "./subscription-billing-filters.ts";
import {
  buildUsageShareData,
  computeUsageShare,
  formatQuotaInteger,
  formatQuotaUsd,
} from "./subscription-stats.ts";
import { buildSubscriptionsQuery } from "./subscriptions.ts";

function filters(
  overrides: Partial<SubscriptionBillingFilters> = {},
): SubscriptionBillingFilters {
  return {
    preset: "this_month",
    startInput: "2025-03-01T00:00",
    endInput: "2025-03-18T12:00",
    startTimestamp: 1_740_758_400,
    endTimestamp: 1_742_270_400,
    windowLabel: "本月",
    validationMessage: null,
    ...overrides,
  };
}

describe("buildSubscriptionsQuery", () => {
  it("uses logs.quota and a whitespace-tolerant text regex without casting malformed JSON", () => {
    const plan = buildSubscriptionsQuery(filters());

    assert.match(plan.sql, /l\.type = 2/);
    assert.match(plan.sql, /l\.quota/);
    assert.match(plan.sql, /l\.other LIKE '\{%'/);
    assert.ok(
      plan.sql.includes(
        `l.other ~ '"billing_source"[[:space:]]*:[[:space:]]*"subscription"'`,
      ),
    );
    assert.doesNotMatch(plan.sql, /::jsonb/i);
    assert.doesNotMatch(plan.sql, /billing_source":"subscription/);
    assert.match(plan.sql, /GROUP BY sl\.user_id/);
    assert.match(plan.sql, /ORDER BY lu\.amount_used DESC/);
    assert.doesNotMatch(plan.sql, /subscription_consumed/);
    assert.doesNotMatch(plan.sql, /subscription_id/);
    assert.doesNotMatch(plan.sql, /l\.created_at\s*[<>]=?\s*us\.(start_time|end_time)/);
  });

  it("binds bounded ranges and leaves all-time without time conditions", () => {
    const bounded = buildSubscriptionsQuery(filters());
    assert.deepEqual(bounded.values, [1_740_758_400, 1_742_270_400]);
    assert.match(bounded.sql, /l\.created_at >= \$1/);
    assert.match(bounded.sql, /l\.created_at <= \$2/);

    const all = buildSubscriptionsQuery(
      filters({
        preset: "all",
        startInput: "",
        endInput: "",
        startTimestamp: null,
        endTimestamp: null,
        windowLabel: "全部时间",
      }),
    );
    assert.deepEqual(all.values, []);
    assert.doesNotMatch(all.sql, /l\.created_at >= \$/);
    assert.doesNotMatch(all.sql, /l\.created_at <= \$/);
  });

  it("ranks only log users and keeps subscription tables only for top-level counts", () => {
    const { sql } = buildSubscriptionsQuery(filters());
    assert.match(sql, /FROM subscription_logs sl\s+GROUP BY sl\.user_id/);
    assert.match(sql, /LEFT JOIN users u ON u\.id = lu\.user_id/);
    assert.match(sql, /subscription_summary AS/);
    assert.doesNotMatch(sql, /subscription_metadata/);
    assert.doesNotMatch(sql, /subscription_plans/);
    assert.doesNotMatch(sql, /JOIN user_subscriptions us/);
    assert.doesNotMatch(sql, /amount_total|subscription_count|upgrade_groups|earliest_end|latest_end/);
  });
});

describe("subscription quota formatting", () => {
  it("formats integers beyond Number.MAX_SAFE_INTEGER exactly", () => {
    assert.equal(formatQuotaInteger("900719925474099312345"), "900,719,925,474,099,312,345");
    assert.equal(formatQuotaInteger("not-quota"), "not-quota");
    assert.equal(formatQuotaInteger(""), "0");
  });

  it("formats USD with fixed-point half-up cent rounding", () => {
    assert.equal(formatQuotaUsd("500000"), "$1.00");
    assert.equal(formatQuotaUsd("4999"), "$0.01");
    assert.equal(formatQuotaUsd("2499"), "$0.00");
    assert.equal(formatQuotaUsd("900719925474099312345"), "$1,801,439,850,948,198.62");
    assert.equal(formatQuotaUsd("invalid"), "$0.00");
  });
});

describe("computeUsageShare", () => {
  it("returns an exact scaled 0..1 fraction for huge quota strings", () => {
    assert.equal(computeUsageShare("9007199254740993", "36028797018963972"), 0.25);
    assert.equal(computeUsageShare("250", "1000"), 0.25);
  });

  it("sums to 1 across exactly representable shares", () => {
    const rows = ["300", "500", "200"];
    const sum = rows.reduce((acc, used) => acc + computeUsageShare(used, "1000"), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it("clamps invalid, non-positive, and over-total values", () => {
    assert.equal(computeUsageShare("100", "0"), 0);
    assert.equal(computeUsageShare("abc", "1000"), 0);
    assert.equal(computeUsageShare("1001", "1000"), 1);
  });
});

describe("buildUsageShareData", () => {
  it("preserves SQL row order and exposes only ratio numbers to the chart", () => {
    const data = buildUsageShareData(
      [
        { name: "first", amountUsed: "9007199254740993000" },
        { name: "second", amountUsed: "9007199254740993999" },
        { name: "third", amountUsed: "1" },
      ],
      "18014398509481987000",
      2,
    );

    assert.deepEqual(data.map((row) => row.name), ["first", "second", "其他 (1)"]);
    assert.deepEqual(Object.keys(data[0]).sort(), ["name", "share"]);
  });
});
