import { ImageResponse } from "next/og";

// Apple touch icon (180×180) — gold "RT" monogram on charcoal.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg,#141a2b,#0B0F19)",
          color: "#C2870B",
          fontSize: 104,
          fontWeight: 800,
          fontFamily: "sans-serif",
          letterSpacing: -4,
        }}
      >
        RT
      </div>
    ),
    { ...size }
  );
}
