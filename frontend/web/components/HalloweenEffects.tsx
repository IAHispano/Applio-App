"use client";

import { Moon, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useState } from "react";
import { IconButton } from "@/components/ui";
import { buildMountainKingScore } from "@/lib/haunted-score";
import { useI18n } from "@/lib/i18n";
import { useSeasonalAmbience } from "@/lib/music-box";

const EMBERS = Array.from({ length: 12 }, (_, offset) => ({ id: `ember-${offset}`, offset }));

function Cobweb({ mirror = false }: { mirror?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`haunt-web ${mirror ? "haunt-web-right" : ""}`}
      viewBox="0 0 240 240"
      fill="none"
    >
      <path d="M0 0 232 22M0 0 218 84M0 0 174 156M0 0 103 211M0 0 28 235" />
      {[0.24, 0.45, 0.68, 0.92].map((scale) => (
        <path
          key={scale}
          transform={`scale(${scale})`}
          d="M232 22Q196 46 218 84Q174 104 174 156Q126 152 103 211Q62 184 28 235"
        />
      ))}
    </svg>
  );
}

function Spider({ className }: { className: string }) {
  return (
    <div className={`haunt-spider ${className}`}>
      <div className="haunt-silk" />
      <svg aria-hidden="true" viewBox="0 0 100 90" fill="none">
        <g className="haunt-legs">
          <path d="M42 44 23 26 8 34M40 49 17 43 3 55M40 55 18 62 9 78M44 60 32 76 29 88M58 44 77 26 92 34M60 49 83 43 97 55M60 55 82 62 91 78M56 60 68 76 71 88" />
        </g>
        <ellipse cx="50" cy="39" rx="14" ry="20" fill="#21132c" stroke="#9e658d" />
        <ellipse cx="50" cy="58" rx="11" ry="12" fill="#160c20" stroke="#9e658d" />
        <path d="m44 31 6 9 6-9-6 4Z" fill="#dc7139" />
        <g className="haunt-spider-eyes" fill="#ffb654">
          <circle cx="46" cy="58" r="2.4" />
          <circle cx="54" cy="58" r="2.4" />
        </g>
      </svg>
    </div>
  );
}

function Pumpkin({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`haunt-pumpkin ${small ? "haunt-pumpkin-small" : ""}`}
      viewBox="0 0 120 120"
      fill="none"
    >
      <path d="m57 35 3-19 13-5-6 23" fill="#747647" stroke="#aaa265" strokeWidth="2" />
      <path
        d="M60 34C29 17 6 47 13 79c6 27 26 33 47 26 22 8 44 0 49-28 6-31-18-59-49-43Z"
        fill="#592515"
        stroke="#c66a31"
        strokeWidth="2"
      />
      <path
        d="M42 34C19 57 27 91 40 105M78 34c22 24 14 58 1 71M60 35v68"
        stroke="#d67b38"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <g className="haunt-candle" fill="#ffc35d" stroke="#ff9b42" strokeWidth="1.5">
        <path d="m31 53 20 14-23 1ZM88 53 68 67l24 1ZM60 67l-6 12h12ZM30 81l14 5 6-5 8 9 9-8 7 5 15-7c-6 22-46 25-59 1Z" />
      </g>
    </svg>
  );
}

const AMBIENCE_SCORE = buildMountainKingScore();

function HauntedScene() {
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
      <div className="haunt-scene" aria-hidden="true">
        <div className="haunt-moon">
          <Moon size={72} strokeWidth={0.6} />
        </div>
        <Cobweb />
        <Cobweb mirror />
        <Spider className="haunt-spider-left" />
        <Spider className="haunt-spider-right" />
        <div className="haunt-bats">
          {[0, 1, 2].map((bat) => (
            <svg
              aria-hidden="true"
              key={bat}
              className={`haunt-bat haunt-bat-${bat}`}
              viewBox="0 0 100 50"
              fill="currentColor"
            >
              <g className="haunt-wing-left">
                <path d="M49 27C32 4 16 20 2 4c0 20 10 26 19 30 2-9 13-7 15 2 5-6 9-3 13-1Z" />
              </g>
              <g className="haunt-wing-right">
                <path d="M51 27C68 4 84 20 98 4c0 20-10 26-19 30-2-9-13-7-15 2-5-6-9-3-13-1Z" />
              </g>
              <path d="m45 16 5 5 5-5 3 17-8 12-8-12Z" />
              <path d="M47 28h2m2 0h2" stroke="#ffb654" strokeWidth="2" />
            </svg>
          ))}
        </div>
        <div className="haunt-eyes">
          <i />
          <i />
        </div>
        <div className="haunt-pumpkins">
          <Pumpkin />
          <Pumpkin small />
        </div>
        <div className="haunt-fog haunt-fog-back" />
        <div className="haunt-fog" />
        <div className="haunt-embers">
          {EMBERS.map((ember) => (
            <i key={ember.id} style={{ "--ember": ember.offset } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="haunt-controls">
        <IconButton
          icon={sound && !quiet ? <Volume2 size={15} /> : <VolumeX size={15} />}
          label={t(
            quiet
              ? "Halloween sounds are paused on this page"
              : sound
                ? "Mute Halloween sounds"
                : "Enable Halloween sounds",
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

export default function HalloweenEffects() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setActive(root.dataset.themeEffects === "halloween");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme-effects"] });
    return () => observer.disconnect();
  }, []);
  return active ? <HauntedScene /> : null;
}
