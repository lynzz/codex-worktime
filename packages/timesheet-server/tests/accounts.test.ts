import { describe, expect, it } from "vitest";
import { addUser, hashPassword, isValidUsername, verifyPassword } from "../src/accounts";

describe("account password hashing (without a database)", () => {
  it("verifies the original password, rejects another password, and salts independently", async () => {
    const password = " preserved password 密码 ";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password, second)).toBe(true);
    expect(await verifyPassword(password.trim(), first)).toBe(false);
    expect(await verifyPassword("wrong-password", first)).toBe(false);
  });

  it("rejects malformed encodings, altered work factors, and noncanonical base64", async () => {
    const password = "password";
    const hash = await hashPassword(password);
    const parts = hash.split("$");
    const salt = parts[2]!;
    const digest = parts[3]!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    // The final salt sextet uses only two high bits; changing its padding bits
    // yields the same decoded salt, but must not be accepted as canonical encoding.
    const finalSextet = alphabet.indexOf(salt[21]!);
    const noncanonicalSalt = `${salt.slice(0, 21)}${alphabet[finalSextet + 1]}==`;
    for (const malformed of [
      hash.replace("100000", "1"), hash.replace("100000", "0100000"),
      hash.replace("pbkdf2", "PBKDF2"), `${hash}$extra`, `${hash}\n`,
      `pbkdf2$100000$${salt.slice(0, -2)}$${digest}`,
      `pbkdf2$100000$${noncanonicalSalt}$${digest}`,
      `pbkdf2$100000$${salt}$${digest.slice(1)}`,
    ]) {
      expect(await verifyPassword(password, malformed)).toBe(false);
    }
  });

  it("accepts short existing passwords but rejects empty and oversized passwords before account writes", async () => {
    const hash = await hashPassword("x");
    expect(await verifyPassword("x", hash)).toBe(true);
    await expect(hashPassword("")).rejects.toThrow("口令不能为空");
    await expect(addUser("valid-user", "")).rejects.toThrow("口令不能为空");
    await expect(addUser("valid-user", "a".repeat(1025))).rejects.toThrow("1024");
    await expect(addUser("valid-user", "密".repeat(342))).rejects.toThrow("1024");
  });

  it("validates exact username alphabet and length without normalizing", async () => {
    expect(isValidUsername("lz")).toBe(true);
    expect(isValidUsername("a".repeat(32))).toBe(true);
    expect(isValidUsername("user_1-name")).toBe(true);
    for (const username of ["a", "a".repeat(33), "Lzz", "lzz ", "lzz\n", "lzz\r", "用戶", "l.zz", ""]) {
      expect(isValidUsername(username)).toBe(false);
      await expect(addUser(username, "password")).rejects.toThrow("用户名须为");
    }
  });
});
