import { api, resolveImageUrl } from './client';

export interface CatalogMark {
  id: string;
  name: string | null;
  cyrillic_name: string | null;
  popular: boolean | null;
}

export interface CatalogModel {
  id: string;
  name: string | null;
  cyrillic_name: string | null;
  year_from: number | null;
  year_to: number | null;
}

export interface CatalogGeneration {
  id: string;
  name: string | null;
  year_from: number | null;
  year_to: number | null;
}

export interface CatalogConfiguration {
  id: string;
  name: string | null;
  body_type: string | null;
  doors_count: number | null;
}

export interface CatalogModification {
  id: string;
  name: string | null;
  group_name: string | null;
}

export interface CatalogColor {
  id: string;
  name_ru: string;
  name_en: string | null;
  hex_code: string | null;
}


export interface GeoCity {
  id: string;
  name_ru: string;
  name_en: string | null;
}

export const catalogApi = {
  searchMarks: (q: string) =>
    api.get<CatalogMark[]>(`/catalog/marks?q=${encodeURIComponent(q)}`),

  getModels: (markId: string) =>
    api.get<CatalogModel[]>(`/catalog/marks/${markId}/models`),

  getGenerations: (modelId: string) =>
    api.get<CatalogGeneration[]>(`/catalog/models/${modelId}/generations`),

  getConfigurations: (genId: string) =>
    api.get<CatalogConfiguration[]>(`/catalog/generations/${genId}/configurations`),

  getModifications: (confId: string) =>
    api.get<CatalogModification[]>(`/catalog/configurations/${confId}/modifications`),

  getColors: () =>
    api.get<CatalogColor[]>('/catalog/colors'),

  searchCities: (q = '') =>
    api.get<GeoCity[]>(`/geo/cities?q=${encodeURIComponent(q)}`),

  getPopularCities: () =>
    api.get<GeoCity[]>('/geo/cities'),
};

// City-by-ID resolver (module-level cache, fetched once per session)
let _allCitiesCache: GeoCity[] | null = null;
let _fetchingCities: Promise<GeoCity[]> | null = null;

async function getAllCities(): Promise<GeoCity[]> {
  if (_allCitiesCache) return _allCitiesCache;
  if (_fetchingCities) return _fetchingCities;
  // ?all=true returns { popular: GeoCity[], all: GeoCity[] } — extract the array
  _fetchingCities = api.get<{ popular?: GeoCity[]; all?: GeoCity[] } | GeoCity[]>('/geo/cities?all=true')
    .then(resp => {
      const cities: GeoCity[] = Array.isArray(resp)
        ? resp
        : ((resp as { all?: GeoCity[]; popular?: GeoCity[] }).all
            ?? (resp as { popular?: GeoCity[] }).popular
            ?? []);
      _allCitiesCache = cities;
      _fetchingCities = null;
      return cities;
    });
  return _fetchingCities;
}

/** Возвращает русское название города по его id (из поля city_id листинга). */
export async function resolveCityName(cityId: string): Promise<string | null> {
  const cities = await getAllCities();
  return cities.find(c => c.id === cityId)?.name_ru ?? null;
}

export interface MyListingImage {
  id: string;
  url: string;
  thumbnail_url: string;
  is_primary: boolean;
  sort_order: number;
}

export interface MyListing {
  id: string;
  mark_id: string;
  model_id: string;
  modification_id?: string;
  year: number;
  price: number;
  mileage: number;
  status: string;
  created_at: string;
  description: string | null;
  vin: string | null;
  license_plate: string | null;
  color_id: string | null;
  city_id: string | null;
  condition: string | null;
  sale_address: string | null;
  viewing_enabled: boolean | null;
  accepts_cash: boolean | null;
  accepts_transfer: boolean | null;
  images?: MyListingImage[];
}

export interface ListingCreateBody {
  modification_id: string;
  year: number;
  price: number;
  mileage: number;
  color_id: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  city_id: string;
  vin?: string;
  license_plate?: string;
  description?: string;
  sale_address?: string;
  viewing_enabled?: boolean;
  accepts_cash?: boolean;
  accepts_transfer?: boolean;
}

function resolveListingImages(listing: MyListing): MyListing {
  if (!listing.images) return listing;
  return {
    ...listing,
    images: listing.images.map(img => ({
      ...img,
      url: resolveImageUrl(img.url),
      thumbnail_url: resolveImageUrl(img.thumbnail_url),
    })),
  };
}

export const listingsApi = {
  create: (body: ListingCreateBody) =>
    api.post<{ id: string }>('/listings', body),

  uploadImages: async (listingId: string, files: File[]): Promise<void> => {
    const token = localStorage.getItem('access_token');
    const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE_URL}/listings/${listingId}/images`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Ошибка загрузки' }));
        throw new Error(err.detail ?? 'Ошибка загрузки');
      }
    }
  },

  publish: (listingId: string) =>
    api.post<{ id: string; status: string }>(`/listings/${listingId}/publish`, {}),

  my: () => api.get<MyListing[]>('/listings/my').then(list => list.map(resolveListingImages)),

  get: (listingId: string) =>
    api.get<MyListing>(`/listings/${listingId}`).then(resolveListingImages),

  update: (listingId: string, body: Partial<ListingCreateBody>) =>
    api.patch<MyListing>(`/listings/${listingId}`, body),

  archive: (listingId: string) => api.delete<unknown>(`/listings/${listingId}`),

  deleteImage: (listingId: string, imageId: string) =>
    api.delete<{ deleted: boolean }>(`/listings/${listingId}/images/${imageId}`),
};
