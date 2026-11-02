'use client';

import { createContext, useContext } from 'react';

/** Table owns its editing contract. Portalled form surfaces explicitly reset it. */
const FieldSurfaceContext = createContext<'grid' | 'form' | undefined>(
  undefined,
);
export const FieldSurfaceProvider = FieldSurfaceContext.Provider;

export function useFieldVariant(
  variant: 'default' | 'grid' | 'search' = 'default',
) {
  const surface = useContext(FieldSurfaceContext);
  if (surface === 'grid') return 'grid';
  if (surface === 'form' && variant === 'grid') return 'default';
  return variant;
}
