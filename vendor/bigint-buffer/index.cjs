"use strict";
function toBigIntBE(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("Expected a Buffer");
  const hex = bytes.toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}
function toBigIntLE(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("Expected a Buffer");
  return toBigIntBE(Buffer.from(bytes).reverse());
}
function toBufferBE(value, width) {
  if (typeof value !== "bigint" || value < 0n)
    throw new RangeError("Expected an unsigned BigInt");
  if (!Number.isSafeInteger(width) || width < 0 || width > 1048576)
    throw new RangeError("Invalid buffer width");
  if (width === 0) {
    if (value !== 0n) throw new RangeError("Integer overflow");
    return Buffer.alloc(0);
  }
  const hex = value.toString(16);
  if (hex.length > width * 2) throw new RangeError("Integer overflow");
  return Buffer.from(hex.padStart(width * 2, "0"), "hex");
}
function toBufferLE(value, width) {
  return toBufferBE(value, width).reverse();
}
module.exports = { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE };
