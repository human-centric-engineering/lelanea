-- §08 t-55: the generation status read asks for the most recent turn anyone
-- finished. Without this it is a scan of every turn on every status request.
CREATE INDEX "app_turn_completedAt_idx" ON "app_turn"("completedAt");
