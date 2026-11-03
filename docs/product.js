export function validateProduct(value) {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.trim().length > 160
  ) {
    return { error: "Enter a product name between 1 and 160 characters." };
  }
  // Accept decimal strings so money never passes through floating-point arithmetic.
  if (
    typeof value.price !== "string" ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(value.price.trim())
  ) {
    return {
      error:
        "Enter a price from 0 to 9,999,999,999.99 with up to two decimal places.",
    };
  }
  const [whole, fraction = ""] = value.price.trim().split(".");
  return {
    product: {
      name: value.name.trim(),
      price: `${BigInt(whole)}.${fraction.padEnd(2, "0")}`,
    },
  };
}
