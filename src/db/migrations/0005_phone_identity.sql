ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_phone_uq" ON "user" USING btree ("phone");