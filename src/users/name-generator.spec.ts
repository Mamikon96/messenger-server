import { generateName, type RandomSource } from './name-generator.js';
import { ADJECTIVES, ANIMALS } from './name-words.js';

/** Источник случайности, отдающий заданные значения по кругу. */
function sequence(...values: number[]): RandomSource {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Значение r, при котором floor(r * length) == index. */
function at(index: number, length: number): number {
  return (index + 0.5) / length;
}

describe('name dictionaries', () => {
  it('имеют около 100 слов, без дублей и пустых значений', () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(90);
    expect(ADJECTIVES.length).toBeLessThanOrEqual(110);
    expect(ANIMALS.length).toBeGreaterThanOrEqual(90);
    expect(ANIMALS.length).toBeLessThanOrEqual(110);
    const words = [
      ...ADJECTIVES.flatMap((a) => [a.m, a.f]),
      ...ANIMALS.map((a) => a.name),
    ];
    expect(words.every((w) => /^[А-ЯЁ][а-яё]+$/.test(w))).toBe(true);
    expect(new Set(ADJECTIVES.map((a) => a.m)).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS.map((a) => a.name)).size).toBe(ANIMALS.length);
  });

  it('содержат и мужские, и женские формы/роды', () => {
    expect(ANIMALS.some((a) => a.gender === 'm')).toBe(true);
    expect(ANIMALS.some((a) => a.gender === 'f')).toBe(true);
    expect(ADJECTIVES.every((a) => a.m !== a.f)).toBe(true);
  });
});

describe('generateName: согласование рода', () => {
  for (const animal of ANIMALS) {
    it(`животное «${animal.name}» (${animal.gender}) получает прилагательное своего рода`, () => {
      const animalIndex = ANIMALS.indexOf(animal);
      // Проверяем каждое прилагательное с этим животным.
      for (let adjIndex = 0; adjIndex < ADJECTIVES.length; adjIndex++) {
        const random = sequence(
          at(adjIndex, ADJECTIVES.length),
          at(animalIndex, ANIMALS.length),
        );
        const result = generateName(random);
        const adj = ADJECTIVES[adjIndex];
        expect(result).toEqual({
          firstName: animal.gender === 'm' ? adj.m : adj.f,
          lastName: animal.name,
        });
      }
    });
  }
});

describe('generateName: случайность', () => {
  it('детерминирован при одинаковом источнике случайности', () => {
    expect(generateName(sequence(0.37, 0.81))).toEqual(
      generateName(sequence(0.37, 0.81)),
    );
  });

  it('граничные значения random не выходят за словарь', () => {
    for (const r of [0, 1 - Number.EPSILON]) {
      const result = generateName(() => r);
      expect(ANIMALS.some((a) => a.name === result.lastName)).toBe(true);
    }
  });

  it('со штатным Math.random возвращает словарную пару без суффикса', () => {
    const result = generateName();
    expect(ANIMALS.some((a) => a.name === result.lastName)).toBe(true);
    expect(
      ADJECTIVES.some(
        (a) => a.m === result.firstName || a.f === result.firstName,
      ),
    ).toBe(true);
  });
});

describe('name dictionaries: исключённые слова (BE-D36)', () => {
  it('нет печальных прилагательных и несклоняемых животных', () => {
    const adj = ADJECTIVES.flatMap((a) => [a.m, a.f]);
    for (const w of ['Грустный', 'Одинокий', 'Усталый', 'Голодный', 'Сытый']) {
      expect(adj).not.toContain(w);
    }
    const animals = ANIMALS.map((a) => a.name);
    for (const w of ['Колибри', 'Кенгуру', 'Фламинго']) {
      expect(animals).not.toContain(w);
    }
  });
});
