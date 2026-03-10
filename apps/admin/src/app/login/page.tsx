'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface BrandOption {
  id: string;
  name: string;
  slug: string;
}

export default function LoginPortalPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/brands')
      .then((r) => r.json())
      .then((data) => {
        const list: BrandOption[] = data.brands || [];
        setBrands(list);
        // If only one brand exists, go directly to its login
        if (list.length === 1) {
          router.replace(`/login/${list[0].slug}`);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Support Hub</h1>
          <p className="text-sm text-gray-500 mt-1">Select your brand portal</p>
        </div>

        <div className="space-y-3">
          {brands.map((b) => (
            <a
              key={b.slug}
              href={`/login/${b.slug}`}
              className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm hover:shadow-md hover:border-gray-300 transition-all group"
            >
              <div>
                <div className="font-semibold text-gray-900 group-hover:text-black transition-colors">
                  {b.name}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{b.slug}</div>
              </div>
              <svg
                className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          ))}
        </div>

        {brands.length === 0 && (
          <div className="text-center text-sm text-gray-500">
            No brands configured.
          </div>
        )}
      </div>
    </div>
  );
}
