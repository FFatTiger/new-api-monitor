export const normalizeFraction = (value: unknown) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    if (value.includes("%")) {
      return parseFloat(value) / 100;
    }

    return parseFloat(value);
  }

  return 0;
};
