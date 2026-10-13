import { ADJECTIVES, ANIMALS } from './name-words.js';

/** Источник случайности: число в диапазоне [0, 1), как у `Math.random`. */
export type RandomSource = () => number;

export interface GeneratedName {
  firstName: string;
  lastName: string;
}

function randomInt(random: RandomSource, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

/**
 * Случайное имя «прилагательное + животное» с согласованием рода.
 * Уникальность не проверяется (BE-D36).
 */
export function generateName(
  random: RandomSource = Math.random,
): GeneratedName {
  const adjective = ADJECTIVES[randomInt(random, ADJECTIVES.length)];
  const animal = ANIMALS[randomInt(random, ANIMALS.length)];
  return {
    firstName: animal.gender === 'm' ? adjective.m : adjective.f,
    lastName: animal.name,
  };
}
