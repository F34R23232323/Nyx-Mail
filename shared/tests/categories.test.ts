import { describe, expect, it } from "vitest";
import { classifyMessage } from "../src/categories";

describe("automatic built-in filters", () => {
  it("detects billing and receipts", () => {
    const result = classifyMessage({
      fromAddress: "billing@stripe.com",
      subject: "Your invoice is ready",
      text: "Payment received. Your receipt for $24.00 is attached. Amount due: $0.00.",
    });
    expect(result.categories).toContain("BILLING");
    expect(result.category).toBe("TRANSACTIONS");
  });

  it("detects marketing offers", () => {
    const result = classifyMessage({
      fromAddress: "deals@shop.example",
      subject: "Flash sale — 40% off everything",
      text: "Limited time offer. Shop now and use coupon SAVE40. Free shipping on all orders.",
    });
    expect(result.categories).toContain("MARKETING");
    expect(result.category).toBe("PROMOTIONS");
  });

  it("detects security alerts", () => {
    const result = classifyMessage({
      fromAddress: "security@example.com",
      subject: "Security alert: new sign-in",
      text: "We noticed a new login from a new device. Verify your identity with the verification code.",
    });
    expect(result.categories).toContain("SECURITY");
    expect(result.category).toBe("UPDATES");
  });

  it("detects shipping, travel and newsletter mail", () => {
    const shipping = classifyMessage({
      fromAddress: "shipments@shop.example",
      subject: "Your order has shipped",
      text: "Tracking number 1Z999. The package is out for delivery and arriving today.",
    });
    expect(shipping.categories).toContain("SHIPPING");
    expect(shipping.category).toBe("TRANSACTIONS");

    const travel = classifyMessage({
      fromAddress: "bookings@airline.example",
      subject: "Flight confirmation — NYX123",
      text: "Your itinerary and boarding pass are ready. Check-in opens 24 hours before departure.",
    });
    expect(travel.categories).toContain("TRAVEL");
    expect(travel.category).toBe("UPDATES");

    const newsletter = classifyMessage({
      fromAddress: "news@example.com",
      subject: "The weekly digest: issue #42",
      text: "View this email in your browser. You are receiving this newsletter because you subscribed.",
    });
    expect(newsletter.categories).toContain("NEWSLETTERS");
    expect(newsletter.category).toBe("NEWSLETTERS");
  });

  it("leaves ordinary personal mail in Primary", () => {
    const result = classifyMessage({
      fromAddress: "alex@example.com",
      subject: "Dinner on Saturday?",
      text: "Hey, are you free this weekend? Let me know what works for you.",
    });
    expect(result.categories).toEqual([]);
    expect(result.category).toBe("PRIMARY");
  });
});
