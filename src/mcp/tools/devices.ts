import { z } from "zod";
import type { ToolDef } from "./types.js";

export const deviceTools: ToolDef[] = [
  {
    name: "get_device",
    description:
      "Full detail of one device: every parameter with name, current value, min/max, " +
      "and quantized value labels. Use the deviceId from get_track or insert_device.",
    inputSchema: { deviceId: z.string() },
    handler: async (args, deps) => ({
      device: await deps.inspector.getDevice(args.deviceId as string),
    }),
  },
  {
    name: "insert_device",
    description:
      'Insert a built-in Live device by name (e.g. "Reverb", "Auto Filter") onto a ' +
      "track's device chain, in one undo step. Optional index positions it in the " +
      "chain (0 = first); omitted appends. Third-party plugins are not supported by " +
      "the Ableton API. Returns the new device with its parameters.",
    inputSchema: {
      trackId: z.string(),
      device: z.string(),
      index: z.number().int().min(0).optional(),
    },
    handler: async (args, deps) => ({
      device: await deps.devices.insertDevice(
        args.trackId as string,
        args.device as string,
        args.index as number | undefined,
      ),
    }),
  },
  {
    name: "set_device_params",
    description:
      "Set one or more parameters of a device by name, in one undo step. Values are " +
      "Live-internal raw values within each parameter's [min, max] from get_device. " +
      "All values are validated before any is applied. Returns only the changed " +
      "values; call get_device for the full state.",
    inputSchema: {
      deviceId: z.string(),
      params: z.record(z.string(), z.number()),
    },
    handler: async (args, deps) => {
      const params = args.params as Record<string, number>;
      await deps.devices.setParams(args.deviceId as string, params);
      return { deviceId: args.deviceId, changed: params };
    },
  },
  {
    name: "delete_device",
    description: "Remove a device from its track's chain, in one undo step.",
    inputSchema: { deviceId: z.string() },
    handler: async (args, deps) => {
      await deps.devices.deleteDevice(args.deviceId as string);
      return { deleted: args.deviceId };
    },
  },
];
