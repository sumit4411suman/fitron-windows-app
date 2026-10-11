import type { Gym, PrismaClient } from "../generated/prisma/index.js";
import { generateApiKey, hashApiKey } from "../utils/apiKey.js";
import { AppError } from "../utils/errors.js";
import type { Principal } from "../types/index.js";

export type GymPublic = { gymId: string; name: string; externalId: string | null; status: Gym["status"]; apiKeyPrefix: string; phone: string | null; timezone: string; createdAt: Date; updatedAt: Date };

const toPublic = (g: Gym): GymPublic => ({ gymId: g.id, name: g.name, externalId: g.externalId, status: g.status, apiKeyPrefix: g.apiKeyPrefix, phone: g.phone, timezone: g.timezone, createdAt: g.createdAt, updatedAt: g.updatedAt });

/** Gyms (tenants) and their API keys. Only the hash of a key is stored; the key itself is shown once, at creation or rotation. */
export class GymService {
  constructor(private readonly db: PrismaClient) {}

  async create(input: { name: string; externalId?: string; phone?: string; timezone?: string }): Promise<GymPublic & { apiKey: string }> {
    if (input.externalId) {
      const existing = await this.db.gym.findUnique({ where: { externalId: input.externalId } });
      if (existing) throw new AppError("DUPLICATE_REQUEST", `A gym with externalId "${input.externalId}" already exists (${existing.id}). Rotate its key instead.`, { gymId: existing.id });
    }
    const { key, hash, prefix } = generateApiKey();
    const gym = await this.db.gym.create({ data: { name: input.name, externalId: input.externalId ?? null, phone: input.phone ?? null, timezone: input.timezone ?? "Asia/Kolkata", apiKeyHash: hash, apiKeyPrefix: prefix, session: { create: {} } } });
    return { ...toPublic(gym), apiKey: key };
  }

  async list(): Promise<GymPublic[]> {
    const gyms = await this.db.gym.findMany({ where: { status: { not: "DELETED" } }, orderBy: { createdAt: "asc" } });
    return gyms.map(toPublic);
  }

  async get(gymId: string): Promise<GymPublic> {
    return toPublic(await this.require(gymId));
  }

  async findByExternalId(externalId: string): Promise<GymPublic | null> {
    const g = await this.db.gym.findUnique({ where: { externalId } });
    return g && g.status !== "DELETED" ? toPublic(g) : null;
  }

  async update(gymId: string, patch: { name?: string; phone?: string | null; timezone?: string; status?: "ACTIVE" | "SUSPENDED" }): Promise<GymPublic> {
    await this.require(gymId);
    return toPublic(await this.db.gym.update({ where: { id: gymId }, data: patch }));
  }

  /** A new key; the old one stops working at once. */
  async rotateKey(gymId: string): Promise<{ gymId: string; apiKey: string; apiKeyPrefix: string }> {
    await this.require(gymId);
    const { key, hash, prefix } = generateApiKey();
    await this.db.gym.update({ where: { id: gymId }, data: { apiKeyHash: hash, apiKeyPrefix: prefix } });
    return { gymId, apiKey: key, apiKeyPrefix: prefix };
  }

  /** Soft delete: the key stops working, history stays. The WhatsApp session is logged out by the caller. */
  async remove(gymId: string): Promise<void> {
    await this.require(gymId);
    await this.db.gym.update({ where: { id: gymId }, data: { status: "DELETED", apiKeyHash: `deleted:${gymId}:${Date.now()}` } });
  }

  /** The principal for a bearer token, or null. Suspended and deleted gyms cannot authenticate. */
  async authenticate(apiKey: string): Promise<Principal | null> {
    const gym = await this.db.gym.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    if (!gym) return null;
    if (gym.status !== "ACTIVE") throw new AppError("GYM_SUSPENDED", "This gym's access is suspended.");
    return { kind: "gym", gymId: gym.id, gymName: gym.name };
  }

  async require(gymId: string): Promise<Gym> {
    const gym = await this.db.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.status === "DELETED") throw new AppError("GYM_NOT_FOUND", "Gym not found.");
    return gym;
  }
}
