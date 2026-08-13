import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArabicKeyboard } from "./ArabicKeyboard";

describe("ArabicKeyboard", () => {
  it("renders every base-layer key with its QWERTY legend", () => {
    render(<ArabicKeyboard />);
    const ba = screen.getByRole("button", { name: "key ب" });
    expect(ba).toBeInTheDocument();
    expect(ba.textContent).toContain("F");
  });

  it("lights up the key for the next character, folding hamza forms", () => {
    // أ is typed with the plain-alif key, so that's the key that must glow.
    render(<ArabicKeyboard highlight="أ" />);
    const alif = screen.getByRole("button", { name: "key ا" });
    expect(alif.className).toContain("border-primary");
    const ba = screen.getByRole("button", { name: "key ب" });
    expect(ba.className).not.toContain("border-primary");
  });

  it("emits the tapped character", () => {
    const onKey = vi.fn();
    render(<ArabicKeyboard onKey={onKey} />);
    fireEvent.click(screen.getByRole("button", { name: "key ش" }));
    expect(onKey).toHaveBeenCalledWith("ش");
  });
});
