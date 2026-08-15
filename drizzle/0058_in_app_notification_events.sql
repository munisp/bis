CREATE OR REPLACE FUNCTION "bis_notify_in_app_notification"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('bis_in_app_notifications', NEW."userId"::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "notifications_bis_in_app_event" ON "notifications";
CREATE TRIGGER "notifications_bis_in_app_event"
AFTER INSERT ON "notifications"
FOR EACH ROW
EXECUTE FUNCTION "bis_notify_in_app_notification"();
