import { describe, expect, it } from "vitest";
import { resolveDataCenter } from "../scripts/oauth-setup.js";

describe("resolveDataCenter", () => {
  it("defaults to the US data center for empty input", () => {
    expect(resolveDataCenter("")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.com",
      apiBaseUrl: "https://sprintsapi.zoho.com/zsapi",
    });
  });

  it("accepts a bare suffix", () => {
    expect(resolveDataCenter("com.au")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.com.au",
      apiBaseUrl: "https://sprintsapi.zoho.com.au/zsapi",
    });
  });

  it("accepts the format that broke last time: a full zoho.<suffix> host", () => {
    expect(resolveDataCenter("zoho.com.au")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.com.au",
      apiBaseUrl: "https://sprintsapi.zoho.com.au/zsapi",
    });
  });

  it("accepts an accounts.zoho.<suffix> host", () => {
    expect(resolveDataCenter("accounts.zoho.eu")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.eu",
      apiBaseUrl: "https://sprintsapi.zoho.eu/zsapi",
    });
  });

  it("accepts a sprints.zoho.<suffix> host", () => {
    expect(resolveDataCenter("sprints.zoho.in")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.in",
      apiBaseUrl: "https://sprintsapi.zoho.in/zsapi",
    });
  });

  it("accepts a full URL", () => {
    expect(resolveDataCenter("https://accounts.zoho.jp/")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.jp",
      apiBaseUrl: "https://sprintsapi.zoho.jp/zsapi",
    });
  });

  it("handles Canada's irregular zohocloud.ca domain", () => {
    expect(resolveDataCenter("zohocloud.ca")).toEqual({
      accountsBaseUrl: "https://accounts.zohocloud.ca",
      apiBaseUrl: "https://sprintsapi.zohocloud.ca/zsapi",
    });
    expect(resolveDataCenter("ca")).toEqual({
      accountsBaseUrl: "https://accounts.zohocloud.ca",
      apiBaseUrl: "https://sprintsapi.zohocloud.ca/zsapi",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveDataCenter("COM.AU")).toEqual({
      accountsBaseUrl: "https://accounts.zoho.com.au",
      apiBaseUrl: "https://sprintsapi.zoho.com.au/zsapi",
    });
  });

  it("throws a clear error for an unrecognized data center", () => {
    expect(() => resolveDataCenter("mars")).toThrow(/Unrecognized Zoho data center/);
  });
});
