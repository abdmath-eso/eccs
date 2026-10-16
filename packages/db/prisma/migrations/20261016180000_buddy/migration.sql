-- ECCS Buddy, the AI helper in the restaurant app for the Owner and the Manager, 16 Oct 2026
-- (Stage E). Written by hand.
--
-- A chat, its messages and its confirmation cards. Removing a chat removes its messages and
-- cards; a daily job removes chats 30 days after their last message. The person, restaurant
-- and outlet are plain ids with no foreign key, as on "AiRequest", so removing an outlet or a
-- login never waits on a chat. Nothing existing is changed.

CREATE TABLE "BuddyChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "outletId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuddyMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "opens" JSONB,
    "screen" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ANSWER',
    "aiRequestId" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuddyCard" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "outletId" TEXT,
    "action" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "result" JSONB,
    "reference" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyCard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuddyChat_userId_lastMessageAt_idx" ON "BuddyChat"("userId", "lastMessageAt");
CREATE INDEX "BuddyChat_lastMessageAt_idx" ON "BuddyChat"("lastMessageAt");
CREATE INDEX "BuddyMessage_chatId_createdAt_idx" ON "BuddyMessage"("chatId", "createdAt");
CREATE INDEX "BuddyMessage_userId_role_createdAt_idx" ON "BuddyMessage"("userId", "role", "createdAt");
CREATE INDEX "BuddyCard_chatId_idx" ON "BuddyCard"("chatId");
CREATE INDEX "BuddyCard_userId_status_createdAt_idx" ON "BuddyCard"("userId", "status", "createdAt");

ALTER TABLE "BuddyMessage" ADD CONSTRAINT "BuddyMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "BuddyChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyCard" ADD CONSTRAINT "BuddyCard_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "BuddyChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyCard" ADD CONSTRAINT "BuddyCard_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "BuddyMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
