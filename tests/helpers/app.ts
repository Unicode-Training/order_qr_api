import supertest from 'supertest';
import { createApp } from '../../src/app';

export function createTestClient() {
  return supertest(createApp());
}
