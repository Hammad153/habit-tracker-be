import {
  calculateEvidencePoints,
  calculateIdentityLevel,
} from './evidence.utils';

describe('calculateEvidencePoints', () => {
  it('weights FULL at 2 and reduced kinds at 1', () => {
    expect(calculateEvidencePoints({ FULL: 5, MINIMUM: 1, EMERGENCY: 1 })).toBe(
      12,
    );
    expect(calculateEvidencePoints({ FULL: 0, MINIMUM: 3, EMERGENCY: 0 })).toBe(
      3,
    );
    expect(calculateEvidencePoints({})).toBe(0);
  });
});

describe('calculateIdentityLevel', () => {
  it('starts at level 1 with zero progress', () => {
    const info = calculateIdentityLevel(0);
    expect(info.level).toBe(1);
    expect(info.levelTitle).toBe('Starting');
    expect(info.nextLevelThreshold).toBe(15);
    expect(info.pointsToNextLevel).toBe(15);
    expect(info.progressToNextLevel).toBe(0);
  });

  it('explains progress inside a level band', () => {
    // Band for level 2 is 15..50 (size 35); 15 of it earned.
    const info = calculateIdentityLevel(30);
    expect(info.level).toBe(2);
    expect(info.levelTitle).toBe('Showing Up');
    expect(info.progressToNextLevel).toBe(
      Math.round(((30 - 15) / (50 - 15)) * 100),
    );
    expect(info.pointsToNextLevel).toBe(20);
  });

  it('caps at the maximum level without implying finality', () => {
    const info = calculateIdentityLevel(9999);
    expect(info.level).toBe(5);
    expect(info.levelTitle).toBe('Established');
    expect(info.nextLevelThreshold).toBeNull();
    expect(info.progressToNextLevel).toBeNull();
  });

  it('crosses levels exactly at thresholds', () => {
    expect(calculateIdentityLevel(14).level).toBe(1);
    expect(calculateIdentityLevel(15).level).toBe(2);
    expect(calculateIdentityLevel(49).level).toBe(2);
    expect(calculateIdentityLevel(50).level).toBe(3);
    expect(calculateIdentityLevel(124).level).toBe(3);
    expect(calculateIdentityLevel(125).level).toBe(4);
    expect(calculateIdentityLevel(249).level).toBe(4);
    expect(calculateIdentityLevel(250).level).toBe(5);
  });
});
