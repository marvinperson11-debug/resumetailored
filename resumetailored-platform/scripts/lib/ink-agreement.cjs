// Shared by test-resume-fidelity.cjs (Node render) and e2e-fidelity-browser.cjs (real Chromium render).
/** Fraction of A's ink within `r` px of some B ink (recall) and of B's within `r` of A's (precision). */
function inkAgreement(a, b, w, h, r) {
  const dilate = (m) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
      }
    }
    return out;
  };
  const da = dilate(a), db = dilate(b);
  let ia = 0, ib = 0, ha = 0, hb = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) { ia++; if (db[i]) ha++; }
    if (b[i]) { ib++; if (da[i]) hb++; }
  }
  return { recall: ib ? hb / ib : 1, precision: ia ? ha / ia : 1 };
}


module.exports = { inkAgreement };
