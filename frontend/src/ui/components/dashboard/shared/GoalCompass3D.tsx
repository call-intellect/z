"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";

import styles from "./GoalCompass3D.module.css";

export type GoalCompassDirection = "to_goal" | "drift" | "against";

const FALLBACK_ANGLE: Record<GoalCompassDirection, number> = {
  to_goal: 18,
  drift: 90,
  against: 168,
};

const PARALLAX_AMPLITUDE = 10;

function angleFromScore(
  direction: GoalCompassDirection,
  score: number | null,
): number {
  const clamped = score == null ? null : Math.max(0, Math.min(100, score));
  return clamped == null ? FALLBACK_ANGLE[direction] : (100 - clamped) * 1.8;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function GoalCompass3D({
  direction,
  score,
  caption,
}: {
  direction: GoalCompassDirection;
  score: number | null;
  caption: string;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const angle = angleFromScore(direction, score);

  const onMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (reducedMotion) return;
      const node = stageRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width - 0.5;
      const relY = (event.clientY - rect.top) / rect.height - 0.5;
      setTilt({
        x: -relY * 2 * PARALLAX_AMPLITUDE,
        y: relX * 2 * PARALLAX_AMPLITUDE,
      });
    },
    [reducedMotion],
  );

  const onMouseLeave = useCallback(() => setTilt(null), []);

  const stageStyle: CSSProperties = {
    ["--angle" as string]: `${angle}deg`,
    transform: tilt
      ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`
      : undefined,
  };

  return (
    <div className={styles.compass3d}>
      <div
        ref={stageRef}
        className={styles.stage}
        style={stageStyle}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <div className={styles.bezel} />
        <div className={styles.zones} />
        <div className={styles.dish} />
        <span className={`${styles.cap} ${styles.capTo}`}>к цели</span>
        <span className={`${styles.cap} ${styles.capDrift}`}>дрейф</span>
        <span className={`${styles.cap} ${styles.capAgainst}`}>против</span>
        <div className={styles.needle}>
          <span className={styles.tip} />
          <span className={styles.tail} />
        </div>
        <div className={styles.hub}>
          <span className={styles.score}>{score ?? "—"}</span>
          <span className={styles.scoreCap}>{caption}</span>
        </div>
        <div className={styles.dome} />
      </div>
    </div>
  );
}
