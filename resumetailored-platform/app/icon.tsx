import { ImageResponse } from "next/og";

// Browser favicon — gold "RT" monogram on charcoal. Next serves this at /icon
// and uses it as the favicon (browsers scale it for 16/32).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0F19",
          color: "#C2870B",
          fontSize: 20,
          fontWeight: 800,
          fontFamily: "sans-serif",
          borderRadius: 6,
          letterSpacing: -1,
        }}
      >
        RT
      </div>
    ),
    { ...size }
  );
}
