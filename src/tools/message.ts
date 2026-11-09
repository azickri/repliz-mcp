/** Message payloads shared by the chat and comment DM tools (Facebook and Instagram). */

import { z } from "zod";

const buttonSchema = z
  .object({
    type: z
      .enum(["web_url", "postback"])
      .default("web_url")
      .describe(
        "web_url opens `url`. postback sends `payload` back to the user's webhook as a `postback` event when tapped."
      ),
    title: z.string().describe("Button label, up to 20 characters."),
    url: z.string().optional().describe("Link opened when tapped. Required for web_url."),
    payload: z
      .string()
      .max(1000)
      .optional()
      .describe("Your own value, up to 1000 characters, returned in message.payload. Required for postback."),
  })
  .describe("A button: web_url { title, url } or postback { title, payload }.");

export const buttonObjectSchema = z
  .object({
    text: z
      .string()
      .describe("Text above the buttons, up to 640 characters. With `image` it is the card title, so keep it to 80."),
    image: z.string().optional().describe("Optional public image URL; turns the message into a card."),
    buttons: z.array(buttonSchema).min(1).max(3).describe("1 to 3 buttons."),
  })
  .describe("Text with 1 to 3 web_url or postback buttons.");

export const carouselObjectSchema = z
  .object({
    elements: z
      .array(
        z.object({
          title: z.string().describe("Card title, cut to 80 characters."),
          subtitle: z.string().optional().describe("Text under the title, cut to 80 characters."),
          image: z.string().optional().describe("Public URL of the card image."),
          url: z.string().optional().describe("Link opened when the card itself is tapped."),
          buttons: z.array(buttonSchema).max(3).optional().describe("Up to 3 buttons on this card."),
        })
      )
      .min(1)
      .max(10)
      .describe("1 to 10 cards. Each needs a title and at least one of subtitle, image or buttons."),
  })
  .describe("A carousel of cards swiped sideways.");

export const quickReplyObjectSchema = z
  .object({
    text: z.string().describe("Message text shown above the quick replies."),
    buttons: z
      .array(
        z.object({
          title: z.string().describe("Label, up to 20 characters; also the text the person sends when tapping it."),
          payload: z
            .string()
            .max(1000)
            .describe("Your own value, up to 1000 characters, returned in message.payload of the `chat` webhook."),
        })
      )
      .min(1)
      .max(13)
      .describe("1 to 13 quick replies. They disappear once one is tapped or another message is sent."),
  })
  .describe("Text with tappable quick replies.");
