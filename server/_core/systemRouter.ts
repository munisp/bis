import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { ENV } from "./env";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  testSlackWebhook: adminProcedure
    .mutation(async () => {
      if (!ENV.slackWebhookUrl) {
        return { success: false, error: "SLACK_WEBHOOK_URL is not configured" } as const;
      }
      try {
        const payload = {
          attachments: [
            {
              color: "#36a64f",
              fallback: "BIS Platform — Slack webhook test message",
              pretext: ":white_check_mark: *BIS Platform — Slack Webhook Test*",
              title: "Webhook configuration confirmed",
              text: "This is a test message sent from the BIS Platform Settings page. Your Slack integration is working correctly.",
              fields: [
                { title: "Environment", value: process.env.NODE_ENV ?? "production", short: true },
                { title: "Sent at", value: new Date().toISOString(), short: true },
              ],
              footer: "BIS Platform · Background Intelligence System",
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };
        const res = await fetch(ENV.slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.text();
          return { success: false, error: `Slack returned ${res.status}: ${body}` } as const;
        }
        return { success: true } as const;
      } catch (err: any) {
        return { success: false, error: err?.message ?? "Unknown error" } as const;
      }
    }),

  slackStatus: publicProcedure.query(async () => {
    const configured = !!(ENV.slackWebhookUrl && ENV.slackWebhookUrl.startsWith("https://hooks.slack.com/"));
    return { configured };
  }),

});
