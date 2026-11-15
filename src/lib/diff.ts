export type Seg = { t: "same" | "add" | "del"; s: string };

const MAX_CELLS = 4_000_000;

function push(out: Seg[], t: Seg["t"], s: string) {
  if (!s) return;
  const last = out[out.length - 1];
  if (last?.t === t) last.s += s;
  else out.push({ t, s });
}

/** Character LCS diff, which suits Chinese where word boundaries aren't marked. */
export function diffChars(before: string, after: string): Seg[] {
  const a = [...before];
  const b = [...after];
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const out: Seg[] = [];
  push(out, "same", a.slice(0, pre).join(""));

  if (midA.length * midB.length > MAX_CELLS) {
    push(out, "del", midA.join(""));
    push(out, "add", midB.join(""));
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        push(out, "same", midA[i]);
        i++; j++;
      } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
        push(out, "add", midB[j++]);
      } else {
        push(out, "del", midA[i++]);
      }
    }
  }
  push(out, "same", a.slice(a.length - suf).join(""));
  return readable(out);
}

/** Most of a long text replaced. Marked inline it would be a struck sentence beside a green one, so it reads better as
 * the new text whole with the old one under it. */
export function isRewrite(segs: Seg[]): boolean {
  const len = (t: Seg["t"]) => segs.filter((s) => s.t !== t).reduce((n, s) => n + [...s.s].length, 0);
  const same = segs.filter((s) => s.t === "same").reduce((n, s) => n + [...s.s].length, 0);
  const before = len("add");
  const longer = Math.max(before, len("del"));
  return before > 0 && longer >= 12 && same / longer < 0.5;
}

/** A short match between two changes is coincidence: folding it in shows a rewrite as a rewrite. */
const MIN_ANCHOR = 4;

function readable(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  let del = "";
  let add = "";
  const flush = () => {
    push(out, "del", del);
    push(out, "add", add);
    del = add = "";
  };
  segs.forEach((seg, i) => {
    const inner = i > 0 && i < segs.length - 1;
    if (seg.t === "del") del += seg.s;
    else if (seg.t === "add") add += seg.s;
    else if (inner && [...seg.s].length < MIN_ANCHOR) {
      del += seg.s;
      add += seg.s;
    } else {
      flush();
      push(out, "same", seg.s);
    }
  });
  flush();
  return out;
}
