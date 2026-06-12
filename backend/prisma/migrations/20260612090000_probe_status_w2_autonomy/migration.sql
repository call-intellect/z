-- W2 autonomy (2026-06-12): гейт ценности probe + NUDGE→дайджест
ALTER TYPE "ProbeStatus" ADD VALUE IF NOT EXISTS 'dropped_low_value';
ALTER TYPE "ProbeStatus" ADD VALUE IF NOT EXISTS 'routed_to_digest';
