"use client";

import { Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useState } from "react";
import { IconButton } from "@/components/ui";
import { buildJingleBellsScore } from "@/lib/christmas-score";
import { useI18n } from "@/lib/i18n";
import { useSeasonalAmbience } from "@/lib/music-box";

interface Flake {
  id: string;
  left: number;
  size: number;
  fall: number;
  delay: number;
  opacity: number;
  /** Horizontal window over the fall; may be negative or positive. */
  drift: number;
}

// Deterministic per-flake wander, so the snowfall looks organic without
// re-rolling on every render (and stays SSR-safe).
const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickFlake = (count: number, seed: number, small: boolean): Flake[] => {
  const r = rand(seed);
  return Array.from({ length: count }, (_, index) => ({
    id: `snow-${seed}-${index}`,
    left: 1 + r() * 96,
    size: small ? 1 + r() * 1.6 : 1.7 + r() * 2.7,
    fall: 11 + r() * 15,
    delay: -r() * 26,
    opacity: 0.45 + r() * 0.55,
    drift: (0.5 + r()) * 110 * (r() < 0.5 ? -1 : 1),
  }));
};

const SNOW_FAR = pickFlake(14, 0xa11ce, true).map((f) => ({ ...f, drift: f.drift * 0.55 }));
const SNOW_NEAR = pickFlake(18, 0x5eed, false);
const LIGHT_HUES = ["#ffd9a0", "#ff6b5e", "#ffd166", "#5ee08a", "#6cb4ee", "#ffe9a3"];

// Fairy lights: two draped swags across the top; bulbs hang from short drops
// below the wire and twinkle on independent clocks.
const LIGHTS = (() => {
  const bulbs: { id: string; x: number; y: number; hue: string; drop: number; delay: string }[] = [];
  const swags: [number, number][] = [
    [2, 48],
    [52, 98],
  ];
  let hueIndex = 0;
  let id = 0;
  for (const [from, to] of swags) {
    for (const t of [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.94]) {
      const x = from + (to - from) * t;
      const sag = 34 * 4 * t * (1 - t);
      const y = 6 + sag;
      bulbs.push({
        id: `light-${id++}`,
        x,
        y,
        hue: LIGHT_HUES[hueIndex++ % LIGHT_HUES.length],
        drop: 1.6 + ((t * 3 + hueIndex) % 1.4),
        delay: `${(hueIndex * 0.31).toFixed(2)}s`,
      });
    }
  }
  return bulbs;
})();

// Christmas tree illustration.
// Art: "Christmas tree 2.svg" by Devcore, Wikimedia Commons,
// CC0 (public domain dedication).
// https://commons.wikimedia.org/wiki/File:Christmas_tree_2.svg
function ChristmasTreeArt({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" width="1087.1007" height="1653.7773" id="xt-svg2">
      <defs id="xt-defs4">
        <linearGradient id="xt-linearGradient6523">
          <stop id="xt-stop6525" style={{ stopColor: "#ffffff", stopOpacity: "1" }} offset="0" />
          <stop id="xt-stop6527" style={{ stopColor: "#b0a4ff", stopOpacity: "1" }} offset="1" />
        </linearGradient>
        <linearGradient id="xt-linearGradient6088">
          <stop id="xt-stop6090" style={{ stopColor: "#ffff20", stopOpacity: "1" }} offset="0" />
          <stop id="xt-stop6092" style={{ stopColor: "#b05600", stopOpacity: "1" }} offset="1" />
        </linearGradient>
        <linearGradient id="xt-linearGradient5732">
          <stop id="xt-stop5734" style={{ stopColor: "#608020", stopOpacity: "1" }} offset="0" />
          <stop id="xt-stop5736" style={{ stopColor: "#001b00", stopOpacity: "1" }} offset="1" />
        </linearGradient>
        <linearGradient id="xt-linearGradient5455">
          <stop id="xt-stop5457" style={{ stopColor: "#c0cb50", stopOpacity: "1" }} offset="0" />
          <stop id="xt-stop5459" style={{ stopColor: "#94512c", stopOpacity: "1" }} offset="1" />
        </linearGradient>
        <linearGradient id="xt-linearGradient5447">
          <stop id="xt-stop5449" style={{ stopColor: "#c0dcff", stopOpacity: "1" }} offset="0" />
          <stop id="xt-stop5451" style={{ stopColor: "#22223b", stopOpacity: "1" }} offset="1" />
        </linearGradient>
        <radialGradient
          cx="-600.98065"
          cy="549.00696"
          r="349.41211"
          fx="-600.98065"
          fy="549.00696"
          id="xt-radialGradient6016"
          href="#xt-linearGradient5447"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.79131167,764.08987,728.74409)"
        />
        <radialGradient
          cx="-701.20831"
          cy="829.6521"
          r="91.795853"
          fx="-701.20831"
          fy="829.6521"
          id="xt-radialGradient6018"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.82418139,764.08987,760.04102)"
        />
        <radialGradient
          cx="-414.38516"
          cy="788.22546"
          r="116.12598"
          fx="-414.38516"
          fy="788.22546"
          id="xt-radialGradient6020"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.83228082,764.08987,746.37328)"
        />
        <radialGradient
          cx="-424.91113"
          cy="436.24149"
          r="92.857849"
          fx="-424.91113"
          fy="436.24149"
          id="xt-radialGradient6022"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.82247123,764.08987,691.61816)"
        />
        <radialGradient
          cx="815.90442"
          cy="2744.709"
          r="150.71777"
          fx="815.90442"
          fy="2744.709"
          id="xt-radialGradient6047"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.01935301,0.27110748,965.27028,1909.7822)"
        />
        <radialGradient
          cx="870.8775"
          cy="2598.6409"
          r="135.12094"
          fx="870.8775"
          fy="2598.6409"
          id="xt-radialGradient6050"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02346636,0.3287295,948.87897,1680.1637)"
        />
        <radialGradient
          cx="952.17358"
          cy="2394.0962"
          r="149.61325"
          fx="952.17358"
          fy="2394.0962"
          id="xt-radialGradient6053"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.01938713,0.27158547,976.96826,1708.4383)"
        />
        <radialGradient
          cx="1043.7421"
          cy="2195.6775"
          r="134.42461"
          fx="1043.7421"
          fy="2195.6775"
          id="xt-radialGradient6056"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02311111,0.32375306,941.83439,1490.1755)"
        />
        <radialGradient
          cx="1110.9216"
          cy="2008.6144"
          r="141.84853"
          fx="1110.9216"
          fy="2008.6144"
          id="xt-radialGradient6059"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02361174,0.33076609,928.45239,1394.017)"
        />
        <radialGradient
          cx="1191.7192"
          cy="1849.3901"
          r="125.07628"
          fx="1191.7192"
          fy="1849.3901"
          id="xt-radialGradient6062"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02029465,0.28429845,935.06211,1395.3057)"
        />
        <radialGradient
          cx="1256.3821"
          cy="1671.1989"
          r="136.73918"
          fx="1256.3821"
          fy="1671.1989"
          id="xt-radialGradient6065"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02200183,0.3082135,918.93597,1260.7058)"
        />
        <radialGradient
          cx="1340.1346"
          cy="1516.3719"
          r="134.5591"
          fx="1340.1346"
          fy="1516.3719"
          id="xt-radialGradient6068"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.02073202,0.29042536,914.99151,1205.4498)"
        />
        <radialGradient
          cx="946.4184"
          cy="2086.2207"
          r="362.48981"
          fx="946.4184"
          fy="2086.2207"
          id="xt-radialGradient6071"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.12654686,1.7727373,712.12441,-1572.6483)"
        />
        <radialGradient
          cx="1268.3248"
          cy="2142.3535"
          r="352.96762"
          fx="1268.3248"
          fy="2142.3535"
          id="xt-radialGradient6074"
          href="#xt-linearGradient5455"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.80243867,-0.05728209,0.12720423,1.781946,709.92167,-1644.3388)"
        />
        <radialGradient
          cx="923.4375"
          cy="1908.6111"
          r="196.5625"
          fx="923.4375"
          fy="1908.6111"
          id="xt-radialGradient6094"
          href="#xt-linearGradient6088"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(0.42670365,0,0,0.43663376,2063.7783,397.12204)"
        />
        <radialGradient
          cx="2092.521"
          cy="786.89819"
          r="536.55035"
          fx="2092.521"
          fy="786.89819"
          id="xt-radialGradient6344"
          href="#xt-linearGradient5732"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,1.4551295,574.03497,857.00944)"
        />
        <radialGradient
          cx="-424.91113"
          cy="436.24149"
          r="92.857849"
          fx="-424.91113"
          fy="436.24149"
          id="xt-radialGradient6389"
          href="#xt-linearGradient6088"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.82247123,2475.2727,776.88896)"
        />
        <radialGradient
          cx="-414.38516"
          cy="788.22546"
          r="116.12598"
          fx="-414.38516"
          fy="788.22546"
          id="xt-radialGradient6394"
          href="#xt-linearGradient6088"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.83228082,2479.9602,826.17533)"
        />
        <radialGradient
          cx="-701.20831"
          cy="829.6521"
          r="91.795853"
          fx="-701.20831"
          fy="829.6521"
          id="xt-radialGradient6397"
          href="#xt-linearGradient6088"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.82418139,2479.9602,839.84307)"
        />
        <radialGradient
          cx="-600.98065"
          cy="549.00696"
          r="349.41211"
          fx="-600.98065"
          fy="549.00696"
          id="xt-radialGradient6400"
          href="#xt-linearGradient5447"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,0.79131167,2479.9602,808.54614)"
        />
        <radialGradient
          cx="2092.521"
          cy="786.89819"
          r="536.55035"
          fx="2092.521"
          fy="786.89819"
          id="xt-radialGradient6478"
          href="#xt-linearGradient5732"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,1.4551295,277.934,865.84827)"
        />
        <radialGradient
          cx="435.68118"
          cy="464.89017"
          r="122.10627"
          fx="435.68118"
          fy="464.89017"
          id="xt-radialGradient6529"
          href="#xt-linearGradient6523"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(1,0,0,1.2047152,0,-95.170076)"
        />
      </defs>
      <g transform="translate(-1826.9048,-1144.8599)" id="xt-layer1">
        <path
          d="m 2477.9341,1230.6367 c -63.9763,46.4069 -190.1915,158.763 -260,228.5714 -30.7378,30.7378 129.502,130.498 105.7143,154.2858 -12.0841,12.084 -47.8365,1.061 -62.8572,8.5714 -84.0565,42.0283 -156.6129,56.6129 -208.5714,108.5714 -49.6718,49.6718 102.188,132.0978 100,134.2857 -24.035,24.035 -64.3529,19.3193 -94.2857,34.2857 -65.4036,32.7018 -98.2223,92.5081 -142.8571,137.1429 -35.9478,35.9478 13.804,166.902 57.1428,188.5714 18.5298,9.2649 68.7191,20.2954 74.2857,31.4286 43.5643,87.1286 -137.3946,111.6803 -145.7143,120 -21.2164,21.2164 -35.5855,35.5856 -54.2857,54.2857 -14.3406,14.3407 -15.5281,57.5152 -5.7143,77.1429 10.4158,20.8316 -11.7952,62.4904 5.7143,80 57.8285,57.8285 140.965,165.7142 254.2857,165.7142 53.7538,0 338.5747,-9.2841 357.1429,0 110.8395,55.4198 448.5714,72.9092 448.5714,-114.2857 0,-147.2106 -122.4665,-233.895 -208.5714,-320 -1.1213,-1.1213 92.0514,1.6115 94.2857,-2.8571 4.4947,-8.9895 18.8783,-4.5926 25.7143,-11.4286 23.399,-23.399 51.5851,-113.9727 34.2857,-148.5714 -16.7899,-33.5798 -71.5523,-28.8189 -88.5714,-62.8572 -19.6768,-39.3535 -54.8834,-130.2988 -97.1429,-151.4285 -16.4026,-8.2013 -80,-32.1419 -80,-48.5715 0,-9.8793 72.2579,27.5575 74.2857,28.5715 42.1591,21.0795 112.6066,-4.0352 137.1429,-28.5715 56.9436,-56.9435 -137.0687,-165.6401 -168.5714,-197.1428 -7.1725,-7.1725 -11.4286,-34.8465 -11.4286,-42.8571 0,-6.3261 -23.6458,-19.2114 -17.1429,-25.7143 32.6045,-32.6045 128.5715,45.3286 128.5715,-60 0,-9.4584 3.5007,-33.6421 -2.8572,-40 -11.8824,-11.8824 -12.1823,-24.3647 -20,-40 -26.9939,-53.9879 -228.5714,-57.287 -228.5714,-257.1429 z"
          id="xt-path5730"
          style={{
            fill: "url(#xt-radialGradient6478)",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeLinecap: "butt",
            strokeLinejoin: "miter",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(-296.10097,8.8388346)"
          id="xt-path6100"
          style={{
            fill: "#ff6420",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(89.83654,96.338837)"
          id="xt-path6100-4"
          style={{
            fill: "#2064ff",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(-291.41346,452.58883)"
          id="xt-path6100-4-0"
          style={{
            fill: "#ff6420",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(61.71154,399.46383)"
          id="xt-path6100-4-6"
          style={{
            fill: "#64ff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(221.08654,511.96383)"
          id="xt-path6100-4-1"
          style={{
            fill: "#2064ff",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="translate(-50.78846,-294.28617)"
          id="xt-path6100-4-5"
          style={{
            fill: "#64ff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,975.60703,862.19663)"
          id="xt-path6100-4-5-4"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1068.7428,858.45742)"
          id="xt-path6100-4-5-4-8"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1224.9928,849.08242)"
          id="xt-path6100-4-5-4-3"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1303.1178,836.58242)"
          id="xt-path6100-4-5-4-2"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1149.9928,858.45742)"
          id="xt-path6100-4-5-4-7"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1371.8678,824.08242)"
          id="xt-path6100-4-5-4-4"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1437.4928,799.08242)"
          id="xt-path6100-4-5-4-5"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1493.7428,767.83242)"
          id="xt-path6100-4-5-4-80"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,887.49283,1286.5824)"
          id="xt-path6100-4-5-4-44"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,949.99283,1283.4574)"
          id="xt-path6100-4-5-4-0"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1021.8678,1283.4574)"
          id="xt-path6100-4-5-4-86"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1090.6178,1270.9574)"
          id="xt-path6100-4-5-4-46"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1159.3678,1258.4574)"
          id="xt-path6100-4-5-4-03"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1224.9928,1255.3324)"
          id="xt-path6100-4-5-4-89"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1296.8678,1239.7074)"
          id="xt-path6100-4-5-4-84"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1368.7428,1214.7074)"
          id="xt-path6100-4-5-4-849"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1440.6178,1199.0824)"
          id="xt-path6100-4-5-4-88"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1493.7428,1177.2074)"
          id="xt-path6100-4-5-4-06"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2461.5841,2030.4872 a 47.521584,47.521584 0 1 1 -95.0432,0 47.521584,47.521584 0 1 1 95.0432,0 z"
          transform="matrix(0.5,0,0,0.5,1549.9928,1136.5824)"
          id="xt-path6100-4-5-4-1"
          style={{
            fill: "#ffff20",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "15",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
        <path
          d="m 2422.4761,1230.4866 c 0.3408,0.2137 33.025,-82.5858 33.3362,-82.2368 2.241,2.5129 -0.5549,11.3395 1.3335,13.457 11.8369,13.2729 13.136,44.6338 25.3355,58.3133 1.9744,2.2139 56.0049,-1.4742 56.0049,0 0,4.2148 -24.1431,17.274 -28.0025,19.4378 -3.2479,1.821 -21.3351,18.9433 -21.3351,17.9425 0,-4.8954 50.6452,34.4189 45.3372,40.3708 -7.4824,8.3901 -64.2143,-9.8359 -73.3397,-14.9521 -4.4666,-2.5043 -41.36,29.9043 -48.0041,29.9043 -10.7999,0 26.8172,-46.1854 17.3348,-56.8182 -4.5422,-5.0932 -53.338,-0.4314 -53.338,-2.9904 0,-0.5968 11.6873,-8.9713 14.668,-8.9713 9.7093,0 22.8486,-6.4413 30.6693,-13.4569 z"
          id="xt-path6086"
          style={{
            fill: "url(#xt-radialGradient6094)",
            fillOpacity: "1",
            stroke: "#000000",
            strokeWidth: "6.7776804",
            strokeLinecap: "butt",
            strokeLinejoin: "miter",
            strokeMiterlimit: "4",
            strokeOpacity: "1",
            strokeDasharray: "none",
          }}
        />
      </g>
      <g transform="translate(-1826.9048,-1144.8599)" id="xt-layer2" />
    </svg>
  );
}

function Lights() {
  return (
    <svg
      aria-hidden="true"
      className="xmas-lights"
      viewBox="0 0 100 58"
      fill="none"
      preserveAspectRatio="none"
    >
      <path className="xmas-wire" d="M0 6 Q25 42 50 6 Q75 42 100 6" />
      {LIGHTS.map((light) => (
        <g key={light.id} className="xmas-light" style={{ animationDelay: light.delay }}>
          <line
            x1={light.x}
            y1={light.y}
            x2={light.x}
            y2={light.y + light.drop}
            stroke="#2a2418"
            strokeWidth="0.4"
          />
          <circle cx={light.x} cy={light.y + light.drop + 1.05} r="1.15" fill={light.hue} />
        </g>
      ))}
    </svg>
  );
}

// The theme plays "Jingle Bells" (James Lord Pierpont), an arrangement from
// the public-domain MIDI converted in lib/jingle-bells.ts.
const AMBIENCE_SCORE = buildJingleBellsScore();

function ChristmasScene() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [sound, setSound] = useState(false);
  const quiet = pathname === "/realtime" || pathname === "/report";
  const unlockSound = useSeasonalAmbience(sound, quiet, AMBIENCE_SCORE);
  useEffect(() => {
    if (quiet) setSound(false);
  }, [quiet]);

  return (
    <>
      <div className="xmas-scene" aria-hidden="true">
        <Lights />
        <div className="xmas-snow-far">
          {SNOW_FAR.map((flake) => (
            <i
              key={flake.id}
              style={
                {
                  left: `${flake.left}%`,
                  width: `${flake.size}px`,
                  height: `${flake.size}px`,
                  opacity: flake.opacity,
                  "--fall": `${flake.fall}s`,
                  "--delay": `${flake.delay}s`,
                  "--drift": `${flake.drift}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <ChristmasTreeArt className="xmas-tree" />
        <div className="xmas-snow">
          {SNOW_NEAR.map((flake) => (
            <i
              key={flake.id}
              style={
                {
                  left: `${flake.left}%`,
                  width: `${flake.size}px`,
                  height: `${flake.size}px`,
                  opacity: flake.opacity,
                  "--fall": `${flake.fall}s`,
                  "--delay": `${flake.delay}s`,
                  "--drift": `${flake.drift}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="xmas-glow-left" />
        <div className="xmas-glow-right" />
      </div>
      <div className="xmas-controls">
        <IconButton
          icon={sound && !quiet ? <Volume2 size={15} /> : <VolumeX size={15} />}
          label={t(
            quiet
              ? "Christmas sounds are paused on this page"
              : sound
                ? "Mute Christmas sounds"
                : "Enable Christmas sounds",
          )}
          aria-pressed={sound && !quiet}
          disabled={quiet}
          onClick={() => {
            if (sound) setSound(false);
            else if (unlockSound()) setSound(true);
          }}
        />
      </div>
    </>
  );
}

export default function ChristmasEffects() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setActive(root.dataset.themeEffects === "christmas");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme-effects"] });
    return () => observer.disconnect();
  }, []);
  return active ? <ChristmasScene /> : null;
}
