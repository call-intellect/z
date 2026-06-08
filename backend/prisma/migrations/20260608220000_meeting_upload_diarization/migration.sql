-- ТЗ-5 Ф1 (meeting-upload-diarization). Аддитивно (enum/колонки nullable-or-default/таблица).
ALTER TYPE "MeetingStatus" ADD VALUE 'awaiting_speakers' BEFORE 'ai_processing';

CREATE TYPE "MeetingSource" AS ENUM ('livekit', 'upload');
CREATE TYPE "UploadSpeakerAssignment" AS ENUM ('unassigned', 'employee', 'external', 'excluded');

ALTER TABLE "Meeting" ADD COLUMN "source" "MeetingSource" NOT NULL DEFAULT 'livekit';
ALTER TABLE "Meeting" ADD COLUMN "uploadNumSpeakersHint" INTEGER;

ALTER TABLE "persons" ADD COLUMN "company" VARCHAR(200);
ALTER TABLE "persons" ADD COLUMN "jobTitle" VARCHAR(200);

CREATE TABLE "meeting_upload_speaker" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "turnsCount" INTEGER NOT NULL DEFAULT 0,
    "speakingSeconds" INTEGER NOT NULL DEFAULT 0,
    "sampleText" TEXT NOT NULL,
    "assignment" "UploadSpeakerAssignment" NOT NULL DEFAULT 'unassigned',
    "personId" TEXT,
    "externalName" VARCHAR(200),
    "externalCompany" VARCHAR(200),
    "externalPosition" VARCHAR(200),
    "mergedIntoLabel" TEXT,
    "participantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_upload_speaker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meeting_upload_speaker_meetingId_label_key" ON "meeting_upload_speaker"("meetingId", "label");
CREATE INDEX "meeting_upload_speaker_meetingId_idx" ON "meeting_upload_speaker"("meetingId");
CREATE INDEX "Meeting_tenantId_source_createdAt_idx" ON "Meeting"("tenantId", "source", "createdAt");

ALTER TABLE "meeting_upload_speaker" ADD CONSTRAINT "meeting_upload_speaker_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_upload_speaker" ADD CONSTRAINT "meeting_upload_speaker_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
