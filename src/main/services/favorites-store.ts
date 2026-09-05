import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { app } from 'electron';
import { z } from 'zod';

import type { Favorite, FavoriteInput } from '../../shared/contracts';

const favoriteSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['seat', 'singleStudy', 'seminar']),
  targetId: z.string(),
  name: z.string(),
  location: z.string(),
  floor: z.string(),
  areaId: z.string().optional(),
  priority: z.number().int().nonnegative(),
  createdAt: z.string(),
});

const favoritesSchema = z.array(favoriteSchema).max(500);

export class FavoritesStore {
  private readonly storagePath = join(app.getPath('userData'), 'favorites.json');
  private mutationQueue: Promise<void> = Promise.resolve();

  public async list(): Promise<Favorite[]> {
    try {
      const fileContents = await readFile(this.storagePath, 'utf8');
      const parsedFavorites = favoritesSchema.safeParse(JSON.parse(fileContents));
      if (!parsedFavorites.success) return [];
      return this.normalizePriorities(parsedFavorites.data);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  public async save(input: FavoriteInput): Promise<Favorite[]> {
    return this.enqueueMutation(async () => {
      const favorites = await this.list();
      const existingFavorite = favorites.find((favorite) => (
        favorite.type === input.type && favorite.targetId === input.targetId
      ));

      if (existingFavorite) return favorites;

      favorites.push({
        ...input,
        id: randomUUID(),
        priority: favorites.length,
        createdAt: new Date().toISOString(),
      });
      await this.write(favorites);
      return this.normalizePriorities(favorites);
    });
  }

  public async remove(favoriteId: string): Promise<Favorite[]> {
    return this.enqueueMutation(async () => {
      const favorites = (await this.list()).filter((favorite) => favorite.id !== favoriteId);
      const normalizedFavorites = this.normalizePriorities(favorites);
      await this.write(normalizedFavorites);
      return normalizedFavorites;
    });
  }

  public async move(favoriteId: string, direction: 'up' | 'down'): Promise<Favorite[]> {
    return this.enqueueMutation(async () => {
      const favorites = await this.list();
      const currentIndex = favorites.findIndex((favorite) => favorite.id === favoriteId);
      if (currentIndex < 0) return favorites;

      const currentFavorite = favorites[currentIndex];
      if (!currentFavorite) return favorites;
      const sameTypeIndices = favorites
        .map((favorite, index) => ({ favorite, index }))
        .filter(({ favorite }) => favorite.type === currentFavorite.type)
        .map(({ index }) => index);
      const currentTypePosition = sameTypeIndices.indexOf(currentIndex);
      const adjacentTypePosition = direction === 'up'
        ? currentTypePosition - 1
        : currentTypePosition + 1;
      const adjacentIndex = sameTypeIndices[adjacentTypePosition];
      if (adjacentIndex === undefined) return favorites;

      const adjacentFavorite = favorites[adjacentIndex];
      if (!adjacentFavorite) return favorites;

      favorites[currentIndex] = adjacentFavorite;
      favorites[adjacentIndex] = currentFavorite;
      const normalizedFavorites = this.normalizePriorities(favorites);
      await this.write(normalizedFavorites);
      return normalizedFavorites;
    });
  }

  private normalizePriorities(favorites: Favorite[]): Favorite[] {
    return [...favorites]
      .sort((firstFavorite, secondFavorite) => firstFavorite.priority - secondFavorite.priority)
      .map((favorite, priority) => ({ ...favorite, priority }));
  }

  private async write(favorites: Favorite[]): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(favorites, null, 2), 'utf8');
    try {
      await rename(temporaryPath, this.storagePath);
    } catch {
      await writeFile(this.storagePath, JSON.stringify(favorites, null, 2), 'utf8');
    }
  }

  private enqueueMutation(
    mutation: () => Promise<Favorite[]>,
  ): Promise<Favorite[]> {
    const mutationResult = this.mutationQueue.then(mutation, mutation);
    this.mutationQueue = mutationResult.then(
      () => undefined,
      () => undefined,
    );
    return mutationResult;
  }
}
