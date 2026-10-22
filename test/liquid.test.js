// Liquid Glass physics: Apple's projection, rubber-banding and springs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, rubberband, bandedPosition, nearestIndex, velocityFrom, landingIndex, springStep, atRest, sheetShouldDismiss } from '../src/lib/liquid.js';

test('momentum projection matches Apple’s formula', () => {
  // (v/1000) * d / (1 - d): 1000px/s at 0.998 coasts ~499px.
  assert.ok(Math.abs(project(1000) - 499) < 0.01);
  assert.ok(Math.abs(project(1000, 0.99) - 99) < 0.01);
  assert.equal(project(0), 0);
  assert.ok(project(-500) < 0);
});

test('rubber-banding resists more the further past the edge', () => {
  const a = rubberband(20, 100);
  const b = rubberband(200, 100);
  assert.ok(a > 0 && a < 20);
  assert.ok(b > a && b < 100 * 0.55 * 2);
  assert.equal(rubberband(-20, 100), -a);
  assert.equal(bandedPosition(50, 0, 100, 80), 50);
  assert.ok(bandedPosition(-30, 0, 100, 80) > -30 && bandedPosition(-30, 0, 100, 80) < 0);
});

test('velocity only counts the last 100ms', () => {
  assert.equal(velocityFrom([{ t: 0, p: 0 }, { t: 50, p: 50 }]), 1000);
  // Finger stopped for a while before lifting: reads as still.
  assert.equal(velocityFrom([{ t: 0, p: 0 }, { t: 10, p: 40 }], 500), 0);
});

test('a slow release lands under the finger; a flick carries on', () => {
  const centers = [36, 108, 180, 252, 324];
  assert.equal(nearestIndex(centers, 190), 2);
  assert.equal(landingIndex(centers, 190, 0), 2);
  assert.equal(landingIndex(centers, 190, 1500), 4);
  assert.equal(landingIndex(centers, 190, -1500), 0);
  // Past the ends it clamps instead of choosing nothing.
  assert.equal(landingIndex(centers, 900, 0), 4);
});

test('a critically damped spring settles on target without overshoot', () => {
  let s = { x: 0, v: 0 };
  let max = 0;
  for (let i = 0; i < 120; i++) { s = springStep(s, 100, 1 / 60); max = Math.max(max, s.x); }
  assert.ok(max <= 100.5, `overshot to ${max}`);
  assert.ok(atRest(s, 100));
});

test('a sheet closes on a flick or past halfway, and stays when flicked back up', () => {
  assert.equal(sheetShouldDismiss(60, 0, 600), false); // a small, slow pull springs back
  assert.equal(sheetShouldDismiss(320, 0, 600), true); // let go past halfway
  assert.equal(sheetShouldDismiss(40, 900, 600), true); // a short, quick flick down
  assert.equal(sheetShouldDismiss(400, -800, 600), false); // flicked back up
  assert.equal(sheetShouldDismiss(400, 0, 0), false);
});
