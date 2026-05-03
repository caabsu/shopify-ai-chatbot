export type SortKey = 'most_helpful' | 'most_recent' | 'highest' | 'lowest';

export interface SectionState {
  handle: string;
  page: number;
  perPage: number;
  sort: SortKey;
  ratingFilter: number | null;
  verifiedOnly: boolean;
  withPhotosOnly: boolean;
}

export function defaultState(handle: string, perPage = 10): SectionState {
  return {
    handle,
    page: 1,
    perPage,
    sort: 'most_helpful',
    ratingFilter: null,
    verifiedOnly: false,
    withPhotosOnly: false,
  };
}

