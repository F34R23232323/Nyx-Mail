-- Allow the same RFC Message-ID in different folders (for example the Sent
-- copy and the inbound copy of a message sent to yourself).
DROP INDEX "Message_userId_messageIdHeader_key";

CREATE UNIQUE INDEX "Message_userId_folderId_messageIdHeader_key"
    ON "Message"("userId", "folderId", "messageIdHeader");
