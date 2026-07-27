import { z } from "zod";
import { PortError } from "../../port/errors.js";
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
      "track's device chain, OR duplicate an existing device (duplicateOf: deviceId " +
      "— the copy lands right after the SOURCE, so repeating the call on the same " +
      "source stacks the copies in reverse order; trackId/index must be omitted). " +
      "One undo step. Optional index positions a named insert (0 = first); omitted " +
      "appends. Third-party plugins are not supported by the Ableton API. Returns " +
      "the new device with its parameters.",
    inputSchema: {
      trackId: z.string().optional(),
      device: z.string().optional(),
      duplicateOf: z.string().optional(),
      index: z.number().int().min(0).optional(),
    },
    handler: async (args, deps) => {
      if (args.duplicateOf !== undefined) {
        if (
          args.device !== undefined ||
          args.trackId !== undefined ||
          args.index !== undefined
        ) {
          throw new PortError(
            "INVALID_INPUT",
            "duplicateOf cannot be combined with trackId, device, or index",
            "The duplicate is inserted right after the source device on its own track.",
          );
        }
        return { device: await deps.devices.duplicateDevice(args.duplicateOf as string) };
      }
      if (args.trackId === undefined || args.device === undefined) {
        throw new PortError("INVALID_INPUT", "provide trackId + device, or duplicateOf");
      }
      return {
        device: await deps.devices.insertDevice(
          args.trackId as string,
          args.device as string,
          args.index as number | undefined,
        ),
      };
    },
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
  {
    name: "set_simpler_sample",
    description:
      "Replace the sample loaded in a Simpler device with an audio file " +
      "(absolute path on the machine running Live), in one undo step. Fails " +
      "UNSUPPORTED on any other device type. Returns the loaded sample's path.",
    inputSchema: { deviceId: z.string(), filePath: z.string().min(1) },
    handler: async (args, deps) => {
      const { samplePath } = await deps.devices.setSimplerSample(
        args.deviceId as string,
        args.filePath as string,
      );
      return { deviceId: args.deviceId, samplePath };
    },
  },
];
