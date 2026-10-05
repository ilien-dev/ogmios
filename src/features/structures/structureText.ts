import type { TFunction } from "i18next";
import type { Topic } from "@shared/structures";
import { structuresEn } from "@/lib/i18n/structures.en";

type StructureKey = keyof typeof structuresEn.catalogue;
type TopicKey = keyof typeof structuresEn.topics;

function isStructure(key: string): key is StructureKey {
  return Object.hasOwn(structuresEn.catalogue, key);
}

function isTopic(key: string): key is TopicKey {
  return Object.hasOwn(structuresEn.topics, key);
}

/** How a structure is built; empty for one the interface has no words for. */
export function formOf(key: string, t: TFunction): string {
  return isStructure(key) ? t(`structures.catalogue.${key}.form`) : "";
}

/** When a structure is used; empty for one the interface has no words for. */
export function usageOf(key: string, t: TFunction): string {
  return isStructure(key) ? t(`structures.catalogue.${key}.use`) : "";
}

/** What a sentence with it says; empty for one the interface has no words for. */
export function goalOf(key: string, t: TFunction): string {
  return isStructure(key) ? t(`structures.catalogue.${key}.goal`) : "";
}

/** An idea to put into it; empty for one the interface has no words for. */
export function sampleOf(key: string, t: TFunction): string {
  return isStructure(key) ? t(`structures.catalogue.${key}.sample`) : "";
}

/** What a sentence is about, as it reads after "about". */
export function topicName(topic: Topic, t: TFunction): string {
  if (topic.kind === "interest") {
    return topic.label;
  }
  return isTopic(topic.key) ? t(`structures.topics.${topic.key}`) : topic.key;
}

/**
 * The sizes a session comes in (`structures::SIZES` in Rust), each with its
 * name and about how long it takes.
 */
export const SESSION_SIZES = [
  { size: 10, name: "quick", minutes: 4 },
  { size: 20, name: "normal", minutes: 8 },
  { size: 40, name: "long", minutes: 16 },
  { size: 60, name: "intense", minutes: 25 },
] as const;

/** The size a session starts at until the learner picks another. */
export const DEFAULT_SIZE = 20;
