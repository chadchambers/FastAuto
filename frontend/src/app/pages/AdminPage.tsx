import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Car, Users, FileText, BarChart3, Plus, Edit, Trash2,
  Check, X, RefreshCw, Loader2, ChevronLeft, ChevronRight,
  MessageSquare, DollarSign, AlertCircle, Eye, Search, Upload,
  SlidersHorizontal, ChevronDown, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useSearchParams } from 'react-router';
import {
  adminApi,
  type AdminUser, type AdminCar, type AdminCarOffer,
  type AdminMessage, type DashboardStats,
  type UserCreate, type UserRole, type UserStatus,
  type CarOfferStatus, type MessageStatus,
  type AdminListingFilters,
} from '../api/admin';
import { catalogApi, listingsApi } from '../api/catalog';
import type { CatalogMark, CatalogModel, CatalogGeneration, CatalogConfiguration, CatalogModification, CatalogColor, GeoCity } from '../api/catalog';
import { viewingsApi } from '../api/viewings';
import { formatCatalogId, carsApi } from '../api/cars';
import { useLanguage } from '../i18n/LanguageContext';

type TabType = 'stats' | 'cars' | 'offers' | 'messages' | 'users';

function markLabel(m: CatalogMark) { return m.name ?? m.cyrillic_name ?? formatCatalogId(m.id); }
function modelLabel(m: CatalogModel) { return m.name ?? formatCatalogId(m.id); }

// Helpers

const inputCls = "w-full px-3 py-2 bg-secondary text-foreground placeholder:text-muted-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary border border-border focus:border-primary transition-colors";
const selectCls = "w-full px-3 py-2 bg-secondary text-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary border border-border focus:border-primary transition-colors";

function formatPrice(p: string | number, lang: string): string {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    style: 'currency', currency: 'RUB',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(p));
}
function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
}
function formatMileage(m: number, lang: string): string {
  return `${new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(m)} ${lang === 'ru' ? 'км' : 'km'}`;
}

const _BODY_FALLBACK: Record<string, string> = {
  allroad: 'suv', crossover: 'suv', liftback: 'hatchback', van: 'minivan',
  cabrio: 'convertible', cabriolet: 'convertible', roadster: 'convertible',
  estate: 'wagon', universal: 'wagon', fastback: 'hatchback',
  mpvan: 'minivan', minibus: 'minivan',
};
function normalizeBodyType(raw: string | null): string {
  if (!raw) return '';
  const key = raw.toLowerCase().split(/[\s_]/)[0];
  return _BODY_FALLBACK[key] ?? key;
}
function matchesFuel(dbValue: string, filterKey: string): boolean {
  const v = dbValue.toLowerCase();
  switch (filterKey) {
    case 'petrol':   return v.includes('бензин') || v === 'petrol' || v === 'gasoline' || v.includes('бензинов');
    case 'diesel':   return v.includes('дизел') || v === 'diesel' || v.includes('дизельн');
    case 'electric': return v.includes('электр') || v === 'electric';
    case 'hybrid':   return v.includes('гибрид') || v === 'hybrid';
    case 'gas':      return v.includes('газ') || v === 'gas' || v.includes('lpg') || v.includes('cng');
    default:         return v.includes(filterKey.toLowerCase());
  }
}
function normalizeTransmission(raw: string | null): string {
  if (!raw) return '';
  const v = raw.toLowerCase();
  if (v.includes('автомат') || v === 'automatic') return 'automatic';
  if (v.includes('механ') || v === 'manual') return 'manual';
  if (v.includes('робот') || v === 'robot') return 'robot';
  if (v.includes('вариатор') || v === 'variator') return 'variator';
  return v;
}
// normalizeFuelType kept for openEdit form; filter now uses matchesFuel
function normalizeFuelType(raw: string | null): string {
  if (!raw) return '';
  const v = raw.toLowerCase();
  if (v.includes('бензин') || v === 'petrol' || v === 'gasoline') return 'petrol';
  if (v.includes('дизел') || v === 'diesel') return 'diesel';
  if (v.includes('электр') || v === 'electric') return 'electric';
  if (v.includes('гибрид') || v === 'hybrid') return 'hybrid';
  if (v.includes('газ') || v === 'gas' || v.includes('lpg')) return 'gas';
  return v;
}

const CAR_STATUS_COLORS: Record<string, string> = {
  available: 'bg-accent/10 text-accent',
  reserved: 'bg-primary/10 text-primary',
  sold: 'bg-muted text-muted-foreground',
  inactive: 'bg-secondary text-muted-foreground',
};
const OFFER_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  approved: 'bg-accent/10 text-accent',
  rejected: 'bg-destructive/10 text-destructive',
};
const MSG_STATUS_COLORS: Record<string, string> = {
  open: 'bg-accent/10 text-accent',
  in_progress: 'bg-primary/10 text-primary',
  resolved: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  closed: 'bg-destructive/10 text-destructive',
  new: 'bg-accent/10 text-accent',
};
const USER_STATUS_COLORS: Record<string, string> = {
  active: 'bg-accent/10 text-accent',
  inactive: 'bg-muted text-muted-foreground',
  banned: 'bg-destructive/10 text-destructive',
};

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState<T>(value);
  useEffect(() => {
    const h = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return dv;
}

// Pagination

function Pagination({ skip, limit, count, onChange, ofLabel }: {
  skip: number; limit: number; count: number; onChange: (skip: number) => void; ofLabel: string;
}) {
  const page = Math.floor(skip / limit) + 1;
  const total = Math.ceil(count / limit);
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-sm text-muted-foreground">{skip + 1}–{Math.min(skip + limit, count)} {ofLabel} {count}</p>
      <div className="flex gap-2">
        <button onClick={() => onChange(skip - limit)} disabled={skip === 0}
          className="p-2 border border-border rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-foreground">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 py-2 text-sm text-foreground">{page} / {total}</span>
        <button onClick={() => onChange(skip + limit)} disabled={skip + limit >= count}
          className="p-2 border border-border rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-foreground">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Car Filters

interface CarFiltersState {
  status: string; priceMin: string; priceMax: string;
  mileageMin: string; mileageMax: string; yearMin: string; yearMax: string;
  brands: string[]; models: string[]; transmissions: string[]; fuelTypes: string[]; bodyTypes: string[];
  selectedGenIds: string[]; selectedConfIds: string[]; selectedModifIds: string[];
}
const EMPTY_FILTERS: CarFiltersState = {
  status: '', priceMin: '', priceMax: '', mileageMin: '', mileageMax: '',
  yearMin: '', yearMax: '', brands: [], models: [], transmissions: [], fuelTypes: [], bodyTypes: [],
  selectedGenIds: [], selectedConfIds: [], selectedModifIds: [],
};

function hasActiveFilters(f: CarFiltersState): boolean {
  return !!(f.status || f.priceMin || f.priceMax || f.mileageMin || f.mileageMax ||
    f.yearMin || f.yearMax || f.brands.length || f.models.length || f.transmissions.length ||
    f.fuelTypes.length || f.bodyTypes.length || f.selectedGenIds.length || f.selectedConfIds.length || f.selectedModifIds.length);
}

function applyFilters(
  cars: AdminCar[], f: CarFiltersState, search: string,
  availableGens: CatalogGeneration[] = [], availableConfs: CatalogConfiguration[] = [],
): AdminCar[] {
  return cars.filter(car => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!car.brand.toLowerCase().includes(q) && !car.model.toLowerCase().includes(q) &&
        !(car.vin && car.vin.toLowerCase().includes(q))) return false;
    }
    if (f.status && car.status !== f.status) return false;
    const price = Number(car.price);
    if (f.priceMin && price < Number(f.priceMin)) return false;
    if (f.priceMax && price > Number(f.priceMax)) return false;
    if (f.mileageMin && car.mileage < Number(f.mileageMin)) return false;
    if (f.mileageMax && car.mileage > Number(f.mileageMax)) return false;
    if (f.yearMin && car.year < Number(f.yearMin)) return false;
    if (f.yearMax && car.year > Number(f.yearMax)) return false;
    if (f.brands.length && !f.brands.includes(car.brand)) return false;
    if (f.models.length && !f.models.includes(car.model)) return false;
    const carTransmission = normalizeTransmission(car.transmission);
    const carBodyType = normalizeBodyType(car.body_type);
    // Если у машины нет данных по коробке — не фильтруем (данные грузятся асинхронно)
    if (f.transmissions.length && carTransmission && !f.transmissions.includes(carTransmission)) return false;
    if (f.fuelTypes.length && car.fuel_type && !f.fuelTypes.some(ft => matchesFuel(car.fuel_type!, ft))) return false;
    if (f.bodyTypes.length && (!carBodyType || !f.bodyTypes.includes(carBodyType))) return false;
    if (f.selectedGenIds.length) {
      const matched = f.selectedGenIds.some(genId => {
        const gen = availableGens.find(g => g.id === genId);
        if (!gen || (!gen.year_from && !gen.year_to)) return true;
        return (!gen.year_from || car.year >= gen.year_from) && (!gen.year_to || car.year <= gen.year_to);
      });
      if (!matched) return false;
    }
    if (f.selectedConfIds.length) {
      const bodyTypes = f.selectedConfIds
        .map(id => availableConfs.find(c => c.id === id)?.body_type)
        .filter(Boolean) as string[];
      if (bodyTypes.length > 0 && (!carBodyType || !bodyTypes.includes(carBodyType))) return false;
    }
    return true;
  });
}

function MultiSelectDropdown({ label, options, selected, onToggle, onClear, allLabel, noOptionsLabel, clearLabel }: {
  label: string; options: { value: string; label: string }[];
  selected: string[]; onToggle: (v: string) => void; onClear: () => void;
  allLabel: string; noOptionsLabel: string; clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;
  const displayText = selected.length > 0
    ? selected.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')
    : allLabel;
  return (
    <div className="relative" ref={ref}>
      <p className="text-xs font-semibold text-muted-foreground mb-1">{label}</p>
      <button type="button" onClick={() => { setOpen(!open); setSearch(''); }}
        className={`w-full flex items-center justify-between px-3 py-2 bg-secondary rounded-lg text-sm text-left hover:bg-secondary/80 transition-colors border border-border ${selected.length > 0 ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
        <span className="truncate mr-2">{displayText}</span>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {options.length > 5 && (
            <div className="p-2 border-b border-border">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary rounded-md">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                  placeholder="Поиск..."
                />
              </div>
            </div>
          )}
          <div className="max-h-44 overflow-y-auto py-1">
            {filtered.length === 0
              ? <p className="px-3 py-4 text-sm text-muted-foreground text-center">{noOptionsLabel}</p>
              : filtered.map(opt => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => onToggle(opt.value)}
                className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-secondary/50 text-sm text-foreground text-left"
              >
                <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${selected.includes(opt.value) ? 'bg-primary border-primary' : 'border-border'}`}>
                  {selected.includes(opt.value) && <Check className="w-3 h-3 text-white" />}
                </div>
                {opt.label}
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <button type="button" onClick={onClear} className="text-xs text-destructive hover:underline">{clearLabel}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CarFilterPanel({ filters, onChange, onReset, availableBrands, brandsLoading,
  availableModels, modelsLoading, availableGens, availableConfs, availableModifs,
}: {
  filters: CarFiltersState; onChange: (f: CarFiltersState) => void;
  onReset: () => void; availableBrands: string[]; brandsLoading: boolean;
  availableModels: CatalogModel[]; modelsLoading: boolean;
  availableGens: CatalogGeneration[]; availableConfs: CatalogConfiguration[]; availableModifs: CatalogModification[];
}) {
  const { T } = useLanguage();
  const A = T.admin;
  const set = (patch: Partial<CarFiltersState>) => onChange({ ...filters, ...patch });
  const toggleArr = (key: keyof CarFiltersState, val: string) => {
    const arr = filters[key] as string[];
    set({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  };
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <SlidersHorizontal className="w-4 h-4" /> {A.filters}
        </p>
        {hasActiveFilters(filters) && (
          <button onClick={onReset} className="text-xs text-destructive hover:underline flex items-center gap-1">
            <X className="w-3 h-3" /> {A.reset}
          </button>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">{A.statusLabel.replace(':', '')}</p>
        <div className="flex flex-wrap gap-1.5">
          {[['', A.all], ...Object.entries(A.carStatus)].map(([v, l]) => (
            <button key={v} type="button" onClick={() => set({ status: v })}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${filters.status === v
                ? v ? CAR_STATUS_COLORS[v] + ' ring-2 ring-offset-1 ring-primary/20' : 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">{A.priceFilter}</p>
        <div className="flex gap-2">
          <input type="text" inputMode="numeric" placeholder={A.from} value={filters.priceMin}
            onChange={e => set({ priceMin: e.target.value.replace(/\D/g, '') })} className={inputCls} />
          <input type="text" inputMode="numeric" placeholder={A.to} value={filters.priceMax}
            onChange={e => set({ priceMax: e.target.value.replace(/\D/g, '') })} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">{A.mileageFilter}</p>
        <div className="flex gap-2">
          <input type="text" inputMode="numeric" placeholder={A.from} value={filters.mileageMin}
            onChange={e => set({ mileageMin: e.target.value.replace(/\D/g, '') })} className={inputCls} />
          <input type="text" inputMode="numeric" placeholder={A.to} value={filters.mileageMax}
            onChange={e => set({ mileageMax: e.target.value.replace(/\D/g, '') })} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">{A.yearFilter}</p>
        <div className="flex gap-2">
          <input type="text" inputMode="numeric" placeholder={A.from} value={filters.yearMin}
            onChange={e => set({ yearMin: e.target.value.replace(/\D/g, '') })} className={inputCls} />
          <input type="text" inputMode="numeric" placeholder={A.to} value={filters.yearMax}
            onChange={e => set({ yearMax: e.target.value.replace(/\D/g, '') })} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">{A.brandFilter}</p>
        {brandsLoading ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg text-sm text-muted-foreground border border-border">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {A.loading}
          </div>
        ) : (
          <MultiSelectDropdown label="" options={availableBrands.map(b => ({ value: b, label: b }))}
            selected={filters.brands} onToggle={v => toggleArr('brands', v)}
            allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
            onClear={() => set({ brands: [], models: [], selectedGenIds: [], selectedConfIds: [], selectedModifIds: [] })} />
        )}
      </div>
      {filters.brands.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">{A.modelFilter}</p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg text-sm text-muted-foreground border border-border">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {A.loading}
            </div>
          ) : availableModels.length > 0 ? (
            <MultiSelectDropdown label="" options={availableModels.map(m => ({ value: modelLabel(m), label: modelLabel(m) }))}
              selected={filters.models} onToggle={v => toggleArr('models', v)}
              allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
              onClear={() => set({ models: [], selectedGenIds: [], selectedConfIds: [], selectedModifIds: [] })} />
          ) : (
            <p className="text-xs text-muted-foreground px-1">{A.noModels}</p>
          )}
        </div>
      )}
      {filters.models.length === 1 && availableGens.length > 0 && (
        <MultiSelectDropdown label={A.generationFilter}
          options={availableGens.map(g => ({ value: g.id, label: g.name ?? `${g.year_from ?? ''}–${g.year_to ?? '...'}` }))}
          selected={filters.selectedGenIds}
          onToggle={v => { const next = filters.selectedGenIds.includes(v) ? filters.selectedGenIds.filter(x => x !== v) : [...filters.selectedGenIds, v]; set({ selectedGenIds: next, selectedConfIds: [], selectedModifIds: [] }); }}
          allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
          onClear={() => set({ selectedGenIds: [], selectedConfIds: [], selectedModifIds: [] })} />
      )}
      {filters.selectedGenIds.length > 0 && availableConfs.length > 0 && (
        <MultiSelectDropdown label={A.configFilter}
          options={availableConfs.map(c => ({ value: c.id, label: c.name ?? c.id }))}
          selected={filters.selectedConfIds}
          onToggle={v => { const next = filters.selectedConfIds.includes(v) ? filters.selectedConfIds.filter(x => x !== v) : [...filters.selectedConfIds, v]; set({ selectedConfIds: next, selectedModifIds: [] }); }}
          allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
          onClear={() => set({ selectedConfIds: [], selectedModifIds: [] })} />
      )}
      {filters.selectedConfIds.length > 0 && availableModifs.length > 0 && (
        <MultiSelectDropdown label={A.modifFilter}
          options={availableModifs.map(m => ({ value: m.id, label: m.name ?? m.group_name ?? m.id }))}
          selected={filters.selectedModifIds}
          onToggle={v => { const next = filters.selectedModifIds.includes(v) ? filters.selectedModifIds.filter(x => x !== v) : [...filters.selectedModifIds, v]; set({ selectedModifIds: next }); }}
          allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
          onClear={() => set({ selectedModifIds: [] })} />
      )}
      <MultiSelectDropdown label={A.gearboxFilter}
        options={Object.entries(T.transmission).map(([v, l]) => ({ value: v, label: l }))}
        selected={filters.transmissions} onToggle={v => toggleArr('transmissions', v)}
        allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
        onClear={() => set({ transmissions: [] })} />
      <MultiSelectDropdown label={A.fuelFilter}
        options={Object.entries(T.fuel).map(([v, l]) => ({ value: v, label: l }))}
        selected={filters.fuelTypes} onToggle={v => toggleArr('fuelTypes', v)}
        allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
        onClear={() => set({ fuelTypes: [] })} />
      <MultiSelectDropdown label={A.bodyFilter}
        options={Object.entries(T.body).map(([v, l]) => ({ value: v, label: l }))}
        selected={filters.bodyTypes} onToggle={v => toggleArr('bodyTypes', v)}
        allLabel={A.all} noOptionsLabel={A.noOptions} clearLabel={A.clear}
        onClear={() => set({ bodyTypes: [] })} />
    </div>
  );
}

// FormSearchSelect — single-select dropdown with inline search (used in car create form)

function FormSearchSelect<T extends { id: string }>({
  options, value, onChange, getLabel, placeholder, searchPlaceholder, disabled, loading, noResults,
}: {
  options: T[];
  value: string;
  onChange: (id: string) => void;
  getLabel: (item: T) => string;
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  noResults?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = options.find(o => o.id === value);
  const filtered = q.trim() ? options.filter(o => getLabel(o).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled || loading}
        onClick={() => { setOpen(o => !o); setQ(''); }}
        className={`${inputCls} flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin inline-block" /> : selected ? getLabel(selected) : placeholder}
        </span>
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-muted-foreground" />
          : <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-hidden flex flex-col">
          {options.length > 6 && (
            <div className="p-2 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary rounded-md">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input autoFocus type="text" value={q} onChange={e => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
          )}
          <ul className="overflow-y-auto">
            {filtered.length === 0
              ? <li className="px-3 py-3 text-sm text-muted-foreground text-center">{noResults}</li>
              : filtered.map(item => (
                <li key={item.id}>
                  <button type="button"
                    onClick={() => { onChange(item.id); setOpen(false); setQ(''); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors ${item.id === value ? 'text-primary font-medium' : 'text-foreground'}`}>
                    {getLabel(item)}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// StatsTab

function StatsTab({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  const { T } = useLanguage();
  const A = T.admin;
  if (loading) return <LoadingSpinner />;
  if (!stats) return <ErrorState message={A.statsLoadError} />;
  const cards = [
    { label: A.totalListings, value: stats.active_listings + stats.reserved_listings + stats.sold_listings, sub: `${stats.active_listings} ${A.totalListingsSub}`, icon: Car, color: 'bg-primary/10 text-primary', glow: 'hover:shadow-primary/25' },
    { label: A.soldListings, value: stats.sold_listings, sub: `${stats.reserved_listings} ${A.soldListingsSub}`, icon: DollarSign, color: 'bg-accent/10 text-accent', glow: 'hover:shadow-accent/25' },
    { label: A.totalReservations, value: stats.active_reservations + stats.pending_deals + stats.completed_deals, sub: `${stats.completed_deals} ${A.totalReservationsSub}`, icon: BarChart3, color: 'bg-purple-500/10 text-purple-500', glow: 'hover:shadow-purple-500/25' },
    { label: A.activeReservations, value: stats.active_reservations, sub: `${stats.pending_deals} ${A.activeReservationsSub}`, icon: DollarSign, color: 'bg-green-500/10 text-green-500', glow: 'hover:shadow-green-500/25' },
    { label: A.totalUsers, value: stats.total_users, sub: A.totalUsersSub, icon: Users, color: 'bg-orange-500/10 text-orange-500', glow: 'hover:shadow-orange-500/25' },
    { label: A.openTickets, value: stats.open_tickets, sub: A.openTicketsSub, icon: MessageSquare, color: 'bg-destructive/10 text-destructive', glow: 'hover:shadow-destructive/25' },
    { label: A.inDeal, value: stats.pending_deals, sub: A.inDealSub, icon: FileText, color: 'bg-yellow-500/10 text-yellow-500', glow: 'hover:shadow-yellow-500/25' },
    { label: A.pendingModeration, value: stats.pending_offers, sub: A.pendingModerationSub, icon: Eye, color: 'bg-cyan-500/10 text-cyan-500', glow: 'hover:shadow-cyan-500/25' },
  ];
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">{A.statsTitle}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, sub, icon: Icon, color, glow }) => (
          <div key={label} className={`bg-card rounded-xl border border-border p-5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${glow}`}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm text-muted-foreground">{label}</p>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// CarTableRow

type AdminCarDisplay = Omit<AdminCar, 'price' | 'mileage'> & { price: string; mileage: string };

function CarTableRow({ car, onEdit, onDelete, onStatusChange, onRowClick, carStatusLabels }: {
  car: AdminCarDisplay; onEdit: (car: AdminCarDisplay) => void;
  onDelete: (id: string, name: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onRowClick: (id: string) => void;
  carStatusLabels: Record<string, string>;
}) {
  return (
    <tr className="hover:bg-secondary/50 transition-colors cursor-pointer"
      onClick={e => { if ((e.target as HTMLElement).closest('button, select')) return; onRowClick(car.id); }}>
      <td className="px-4 py-3">
        <p className="font-semibold text-foreground">{car.brand} {car.model}</p>
        {car.color && <p className="text-xs text-muted-foreground">{car.color}</p>}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{car.year}</td>
      <td className="px-4 py-3 font-medium text-foreground">{car.price}</td>
      <td className="px-4 py-3 text-muted-foreground">{car.mileage}</td>
      <td className="px-4 py-3">
        <select value={car.status}
          onChange={e => { e.stopPropagation(); onStatusChange(car.id, e.target.value); }}
          onClick={e => e.stopPropagation()}
          className={`text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer ${CAR_STATUS_COLORS[car.status]}`}>
          {Object.entries(carStatusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => onEdit(car)} className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors">
            <Edit className="w-4 h-4 text-primary" />
          </button>
          <button onClick={() => onDelete(car.id, `${car.brand} ${car.model}`)} className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4 text-destructive" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// CarsTab

const ADMIN_PAGE_SIZE = 20;

async function enrichAdminCars(cars: AdminCar[]): Promise<AdminCar[]> {
  if (cars.length === 0) return cars;
  const results = await Promise.allSettled(cars.map(c => carsApi.get(c.id)));
  return cars.map((c, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      return {
        ...c,
        transmission: r.value.transmission ?? c.transmission,
        fuel_type: r.value.fuel_type ?? c.fuel_type,
        body_type: r.value.body_type ?? c.body_type,
      };
    }
    return c;
  });
}
const TIME_SLOTS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];

function CarsTab() {
  const navigate = useNavigate();
  const { T, lang } = useLanguage();
  const A = T.admin;

  const carStatusLabels = A.carStatus;
  const WEEK_DAYS = T.listing.weekDays;

  // Catalog cascade state
  const [marks, setMarks] = useState<CatalogMark[]>([]);
  const [marksLoading, setMarksLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [availableGens, setAvailableGens] = useState<CatalogGeneration[]>([]);
  const [availableConfs, setAvailableConfs] = useState<CatalogConfiguration[]>([]);
  const [availableModifs, setAvailableModifs] = useState<CatalogModification[]>([]);

  const [filters, setFilters] = useState<CarFiltersState>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [allCars, setAllCars] = useState<AdminCar[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [showForm, setShowForm] = useState(false);
  const [editCar, setEditCar] = useState<AdminCar | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const emptyForm = { brand: '', model: '', year: '', price: '', mileage: '0', color: '', fuel_type: '', transmission: '', body_type: '', engine_volume: '', engine_power: '', description: '', vin: '', viewing_days: [] as string[], viewing_time_from: '09:00', viewing_time_to: '20:00', viewing_address: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // Create-mode extra fields (from CreateListingPage)
  const [colors, setColors] = useState<CatalogColor[]>([]);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [formCondition, setFormCondition] = useState('');
  const [formColorId, setFormColorId] = useState('');
  const [formCityId, setFormCityId] = useState('');
  const [formVin, setFormVin] = useState('');
  const [formLicensePlate, setFormLicensePlate] = useState('');
  const [formSaleAddress, setFormSaleAddress] = useState('');
  const [formAcceptsCash, setFormAcceptsCash] = useState(false);
  const [formAcceptsTransfer, setFormAcceptsTransfer] = useState(false);
  const [formViewingDays, setFormViewingDays] = useState<number[]>([]);
  const [formViewingFrom, setFormViewingFrom] = useState('10:00');
  const [formViewingTo, setFormViewingTo] = useState('18:00');

  // Form cascade state (create mode only)
  const [formMarkId, setFormMarkId] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [formGenId, setFormGenId] = useState('');
  const [formConfId, setFormConfId] = useState('');
  const [formModId, setFormModId] = useState('');
  const [formModels, setFormModels] = useState<CatalogModel[]>([]);
  const [formGens, setFormGens] = useState<CatalogGeneration[]>([]);
  const [formConfs, setFormConfs] = useState<CatalogConfiguration[]>([]);
  const [formMods, setFormMods] = useState<CatalogModification[]>([]);
  const [fmLoading, setFmLoading] = useState(false);
  const [fgLoading, setFgLoading] = useState(false);
  const [fcLoading, setFcLoading] = useState(false);
  const [fmoLoading, setFmoLoading] = useState(false);

  useEffect(() => {
    setMarksLoading(true);
    catalogApi.searchMarks('').then(setMarks).catch(() => {}).finally(() => setMarksLoading(false));
    catalogApi.getColors().then(setColors).catch(() => {});
    catalogApi.getPopularCities().then(setCities).catch(() => {});
  }, []);

  useEffect(() => {
    if (filters.brands.length === 0) { setAvailableModels([]); return; }
    const ids = filters.brands.map(name => marks.find(m => markLabel(m) === name)?.id).filter(Boolean) as string[];
    if (ids.length === 0) return;
    setModelsLoading(true);
    Promise.all(ids.map(id => catalogApi.getModels(id)))
      .then(results => setAvailableModels(results.flat()))
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, [filters.brands, marks]);

  useEffect(() => {
    setAvailableGens([]); setAvailableConfs([]); setAvailableModifs([]);
    if (filters.models.length !== 1) return;
    const modelId = availableModels.find(m => modelLabel(m) === filters.models[0])?.id;
    if (!modelId) return;
    catalogApi.getGenerations(modelId).then(setAvailableGens).catch(() => {});
  }, [filters.models, availableModels]);

  useEffect(() => {
    setAvailableConfs([]); setAvailableModifs([]);
    if (filters.selectedGenIds.length === 0) return;
    Promise.all(filters.selectedGenIds.map(id => catalogApi.getConfigurations(id)))
      .then(results => {
        const seen = new Set<string>();
        const unique = results.flat().filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
        setAvailableConfs(unique);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters.selectedGenIds)]);

  useEffect(() => {
    setAvailableModifs([]);
    if (filters.selectedConfIds.length === 0) return;
    Promise.all(filters.selectedConfIds.map(id => catalogApi.getModifications(id)))
      .then(results => {
        const seen = new Set<string>();
        const unique = results.flat().filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
        setAvailableModifs(unique);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters.selectedConfIds)]);

  const serverFilters = useMemo((): AdminListingFilters => {
    const f: AdminListingFilters = { sort: 'newest', limit: ADMIN_PAGE_SIZE };
    if (filters.priceMin) f.price_min = Number(filters.priceMin);
    if (filters.priceMax) f.price_max = Number(filters.priceMax);
    if (filters.yearMin) f.year_min = Number(filters.yearMin);
    if (filters.yearMax) f.year_max = Number(filters.yearMax);
    // engine_type и body_type НЕ передаём на сервер: в БД хранятся значения вида
    // "Бензиновый" и "SEDAN", а фильтр использует ключи "petrol"/"sedan".
    // Строгое равенство в SQL даст 0 результатов — фильтруем только на клиенте.
    if (filters.brands.length === 1) {
      const mark = marks.find(m => markLabel(m) === filters.brands[0]);
      if (mark) f.mark_id = mark.id;
    }
    if (filters.models.length === 1) {
      const model = availableModels.find(m => modelLabel(m) === filters.models[0]);
      if (model) f.model_id = model.id;
    }
    return f;
  }, [filters.priceMin, filters.priceMax, filters.yearMin, filters.yearMax,
      filters.brands, filters.models, marks, availableModels]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setAllCars([]); setNextCursor(null); setHasMore(false);
    adminApi.getCars(serverFilters)
      .then(async res => {
        if (cancelled) return;
        setAllCars(res.data);
        setNextCursor(res.next_cursor);
        setHasMore(res.next_cursor !== null);
        setLoading(false);
        // Обогащаем данными из detail-эндпоинта (transmission, уточнённые fuel/body)
        const enriched = await enrichAdminCars(res.data);
        if (!cancelled) setAllCars(enriched);
      })
      .catch(() => { if (!cancelled) { toast.error(A.carsLoadError); setLoading(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(serverFilters), refreshKey]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    adminApi.getCars({ ...serverFilters, cursor: nextCursor })
      .then(async res => {
        setAllCars(prev => [...prev, ...res.data]);
        setNextCursor(res.next_cursor);
        setHasMore(res.next_cursor !== null);
        setLoadingMore(false);
        // Обогащаем новую страницу в фоне
        const enriched = await enrichAdminCars(res.data);
        setAllCars(prev => {
          const enrichedMap = new Map(enriched.map((c: AdminCar) => [c.id, c]));
          return prev.map((c: AdminCar) => enrichedMap.get(c.id) ?? c);
        });
      })
      .catch(() => { setLoadingMore(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, nextCursor, JSON.stringify(serverFilters)]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loading]);

  useEffect(() => { return () => { previews.forEach(url => URL.revokeObjectURL(url)); }; }, [previews]);

  const filteredCars = useMemo(
    () => applyFilters(allCars, filters, debouncedSearch, availableGens, availableConfs),
    [allCars, filters, debouncedSearch, availableGens, availableConfs]
  );

  // Format car data for display
  const displayCars = useMemo(() =>
    filteredCars.map(car => ({
      ...car,
      price: formatPrice(car.price, lang),
      mileage: formatMileage(car.mileage, lang),
    })),
    [filteredCars, lang]
  );

  const availableBrands = useMemo(() => marks.map(m => markLabel(m)).sort(), [marks]);
  const handleReload = () => setRefreshKey(k => k + 1);

  const activeFiltersCount = [
    filters.status, filters.priceMin, filters.priceMax,
    filters.mileageMin, filters.mileageMax, filters.yearMin, filters.yearMax,
    ...filters.selectedGenIds, ...filters.selectedConfIds, ...filters.selectedModifIds,
    ...filters.brands, ...filters.models, ...filters.transmissions, ...filters.fuelTypes, ...filters.bodyTypes,
  ].filter(Boolean).length;

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const nf = Array.from(e.target.files);
    setSelectedFiles(p => [...p, ...nf]);
    setPreviews(p => [...p, ...nf.map(f => URL.createObjectURL(f))]);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const nf = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    setSelectedFiles(p => [...p, ...nf]);
    setPreviews(p => [...p, ...nf.map(f => URL.createObjectURL(f))]);
  };
  const removeFile = (i: number) => {
    URL.revokeObjectURL(previews[i]);
    setSelectedFiles(p => p.filter((_, idx) => idx !== i));
    setPreviews(p => p.filter((_, idx) => idx !== i));
  };
  const clearFiles = () => { previews.forEach(url => URL.revokeObjectURL(url)); setSelectedFiles([]); setPreviews([]); };

  const resetFormCascade = () => {
    setFormMarkId(''); setFormModelId(''); setFormGenId(''); setFormConfId(''); setFormModId('');
    setFormModels([]); setFormGens([]); setFormConfs([]); setFormMods([]);
  };

  const onFormMarkChange = (id: string) => {
    setFormMarkId(id); setFormModelId(''); setFormModels([]);
    setFormGenId(''); setFormGens([]); setFormConfId(''); setFormConfs([]);
    setFormModId(''); setFormMods([]);
    const m = marks.find(x => x.id === id);
    setForm(p => ({ ...p, brand: m ? (m.name ?? m.cyrillic_name ?? '') : '' }));
    if (!id) return;
    setFmLoading(true);
    catalogApi.getModels(id).then(setFormModels).catch(() => setFormModels([])).finally(() => setFmLoading(false));
  };

  const onFormModelChange = (id: string) => {
    setFormModelId(id); setFormGenId(''); setFormGens([]);
    setFormConfId(''); setFormConfs([]); setFormModId(''); setFormMods([]);
    const m = formModels.find(x => x.id === id);
    setForm(p => ({ ...p, model: m?.name ?? '' }));
    if (!id) return;
    setFgLoading(true);
    catalogApi.getGenerations(id).then(setFormGens).catch(() => setFormGens([])).finally(() => setFgLoading(false));
  };

  const onFormGenChange = (id: string) => {
    setFormGenId(id); setFormConfId(''); setFormConfs([]); setFormModId(''); setFormMods([]);
    if (!id) return;
    setFcLoading(true);
    catalogApi.getConfigurations(id).then(setFormConfs).catch(() => setFormConfs([])).finally(() => setFcLoading(false));
  };

  const onFormConfChange = (id: string) => {
    setFormConfId(id); setFormModId(''); setFormMods([]);
    if (!id) return;
    setFmoLoading(true);
    catalogApi.getModifications(id).then(setFormMods).catch(() => setFormMods([])).finally(() => setFmoLoading(false));
  };

  const openCreate = () => {
    setEditCar(null); setForm(emptyForm); clearFiles(); resetFormCascade();
    setFormCondition(''); setFormColorId(''); setFormCityId('');
    setFormVin(''); setFormLicensePlate(''); setFormSaleAddress('');
    setFormAcceptsCash(false); setFormAcceptsTransfer(false);
    setFormViewingDays([]); setFormViewingFrom('10:00'); setFormViewingTo('18:00');
    setShowForm(true);
  };
  const openEdit = async (displayCar: AdminCarDisplay) => {
    const car = allCars.find(c => c.id === displayCar.id) ?? (displayCar as unknown as AdminCar);
    setEditCar(car);
    setForm({
      brand: car.brand, model: car.model,
      year: String(car.year), price: String(car.price), mileage: String(car.mileage),
      color: car.color ?? '', fuel_type: car.fuel_type ?? '', transmission: car.transmission ?? '',
      body_type: car.body_type ?? '', engine_volume: car.engine_volume ?? '',
      engine_power: String(car.engine_power ?? ''), description: car.description ?? '',
      vin: car.vin ?? '', viewing_days: [], viewing_time_from: '09:00', viewing_time_to: '20:00', viewing_address: '',
    });
    setFormColorId('');
    setExistingImages([]);
    clearFiles();
    // Инициализируем каскад марок/моделей для режима редактирования
    resetFormCascade();
    if (car.mark_id) {
      setFormMarkId(car.mark_id);
      setFmLoading(true);
      catalogApi.getModels(car.mark_id)
        .then(models => {
          setFormModels(models);
          if (car.model_id) {
            setFormModelId(car.model_id);
            setFgLoading(true);
            catalogApi.getGenerations(car.model_id)
              .then(gens => { setFormGens(gens); })
              .catch(() => {})
              .finally(() => setFgLoading(false));
          }
        })
        .catch(() => setFormModels([]))
        .finally(() => setFmLoading(false));
    }
    setShowForm(true);
    setEditLoading(true);
    try {
      // Все три запроса параллельно; adminDetail и windows не блокируют при ошибке
      const [detail, windows, adminDetail] = await Promise.all([
        carsApi.get(car.id),
        viewingsApi.getAvailableSlots(car.id).catch(() => [] as import('../api/viewings').ViewingWindow[]),
        adminApi.getListingDetail(car.id).catch(() => null as Record<string, unknown> | null),
      ]);

      // VIN: admin-endpoint возвращает полный незамаскированный VIN
      const vin = typeof adminDetail?.vin === 'string'
        ? adminDetail.vin
        : (detail.vin ?? '');

      // Viewing windows: дни и время
      const uniqueDayNames = windows.length > 0
        ? [...new Set(windows.map(w => {
            const [y, mo, d] = w.window_date.split('-').map(Number);
            // JS getDay(): 0=вс,1=пн...6=сб → WEEK_DAYS (Пн=0,Вс=6): (jsDay+6)%7
            return WEEK_DAYS[(new Date(y, mo - 1, d).getDay() + 6) % 7];
          }))]
        : [];

      // Единый вызов setForm — никаких конфликтов батчинга
      setForm(p => ({
        ...p,
        fuel_type: normalizeFuelType(detail.fuel_type),
        transmission: normalizeTransmission(detail.transmission),
        body_type: normalizeBodyType(detail.body_type),
        engine_volume: detail.engine_volume ?? p.engine_volume,
        engine_power: detail.engine_power != null ? String(detail.engine_power) : p.engine_power,
        description: detail.description ?? p.description,
        vin,
        viewing_address: detail.sale_address ?? p.viewing_address,
        ...(windows.length > 0 && {
          viewing_days: uniqueDayNames,
          viewing_time_from: windows[0].time_from.slice(0, 5),
          viewing_time_to: windows[0].time_to.slice(0, 5),
        }),
      }));

      if (detail.color) setFormColorId(detail.color);
      if (detail.condition) setFormCondition(detail.condition ?? '');

      setExistingImages(
        [...detail.images]
          .sort((a, b) => (a.is_primary ? -1 : b.is_primary ? 1 : a.sort_order - b.sort_order))
          .map(img => img.url || img.thumbnail_url)
          .filter(Boolean)
      );
    } catch (err) {
      console.error('[AdminPage] openEdit detail fetch failed:', err);
    } finally {
      setEditLoading(false);
    }
  };

  const saveViewingWindows = async (listingId: string) => {
    if (formViewingDays.length === 0) return;
    const windows: Promise<unknown>[] = [];
    for (let week = 0; week < 4; week++) {
      for (const dayIdx of formViewingDays) {
        const d = new Date();
        const jsDay = (dayIdx + 1) % 7;
        const diff = (jsDay - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff + week * 7);
        windows.push(
          viewingsApi.createWindow(listingId, {
            window_date: d.toISOString().slice(0, 10),
            time_from: formViewingFrom,
            time_to: formViewingTo,
          }).catch(() => null)
        );
      }
    }
    await Promise.all(windows);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editCar) {
      // Create mode — use listingsApi
      if (!formModId) { toast.error(T.listing.chooseModification); return; }
      if (!form.year || !form.price || !form.mileage) { toast.error(T.listing.fillRequired); return; }
      if (!formCondition) { toast.error(T.listing.fillRequired); return; }
      if (!formColorId) { toast.error(T.listing.fillRequired); return; }
      if (!formCityId) { toast.error(T.listing.fillRequired); return; }
      if (!formVin.trim() && !formLicensePlate.trim()) { toast.error(T.listing.fillRequired); return; }
      if (!formAcceptsCash && !formAcceptsTransfer) { toast.error(T.listing.paymentRequired); return; }
      const viewingEnabled = formViewingDays.length > 0;
      if (viewingEnabled && !formSaleAddress.trim()) { toast.error(T.listing.fillRequired); return; }
      setSaving(true);
      try {
        const listing = await listingsApi.create({
          modification_id: formModId,
          year: Number(form.year),
          price: Number(form.price),
          mileage: Number(form.mileage),
          condition: formCondition as 'excellent' | 'good' | 'fair' | 'poor',
          color_id: formColorId,
          city_id: formCityId,
          vin: formVin.trim() || undefined,
          license_plate: formLicensePlate.trim() || undefined,
          description: form.description.trim() || undefined,
          viewing_enabled: viewingEnabled,
          sale_address: formSaleAddress.trim() || undefined,
          accepts_cash: formAcceptsCash,
          accepts_transfer: formAcceptsTransfer,
        });
        if (selectedFiles.length > 0) {
          try { await listingsApi.uploadImages(listing.id, selectedFiles); }
          catch { toast.error(T.listing.photosErrorButCreated); }
        }
        await saveViewingWindows(listing.id);
        try {
          await listingsApi.publish(listing.id);
          toast.success(T.listing.publishedSuccess);
        } catch {
          toast.success(T.listing.savedToDrafts);
        }
        setShowForm(false);
        handleReload();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : T.listing.errorCreate);
      } finally {
        setSaving(false);
      }
    } else {
      // Edit mode — admin patch endpoint
      setSaving(true);
      try {
        await adminApi.updateListing(editCar.id, {
          year: form.year ? Number(form.year) : undefined,
          price: form.price ? Number(form.price) : undefined,
          mileage: form.mileage ? Number(form.mileage) : undefined,
          color_id: formColorId || undefined,
          vin: form.vin.trim() || undefined,
          description: form.description.trim() || undefined,
        });
        if (selectedFiles.length > 0) {
          try { await listingsApi.uploadImages(editCar.id, selectedFiles); }
          catch { toast.error(T.listing.photosErrorEdit); }
        }
        toast.success(A.carDeletedSuccess);
        setShowForm(false);
        handleReload();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : A.carDeleteError);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteModal({ id, name });
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await adminApi.deleteListing(deleteModal.id);
      toast.success(A.carDeletedSuccess);
      setDeleteModal(null);
      handleReload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : A.carDeleteError);
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await adminApi.changeListingStatus(id, newStatus);
      setAllCars(prev => prev.map(c => c.id === id ? { ...c, status: newStatus as AdminCar['status'] } : c));
      toast.success('Статус обновлён');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : A.carStatusChangeError);
    }
  };

  return (
    <div className="flex gap-4">
      <aside className="hidden lg:block w-60 flex-shrink-0">
        <CarFilterPanel filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_FILTERS)}
          availableBrands={availableBrands} brandsLoading={marks.length === 0}
          availableModels={availableModels} modelsLoading={modelsLoading}
          availableGens={availableGens} availableConfs={availableConfs} availableModifs={availableModifs} />
      </aside>

      <div className="flex-1 min-w-0 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-2xl font-semibold text-foreground">
              {A.carsTitle} <span className="text-muted-foreground text-lg font-normal">
                ({loading ? '…' : `${filteredCars.length}${hasMore ? '+' : ''}`})
              </span>
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setFiltersOpen(!filtersOpen)}
                className={`lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${activeFiltersCount > 0 ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary text-foreground'}`}>
                <SlidersHorizontal className="w-4 h-4" /> {A.filters}
                {activeFiltersCount > 0 && <span className="bg-white/20 text-xs px-1.5 rounded-full">{activeFiltersCount}</span>}
              </button>
              {hasActiveFilters(filters) && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="hidden lg:flex items-center gap-1.5 px-3 py-2 bg-destructive/10 text-destructive rounded-lg text-sm hover:bg-destructive/20 transition-colors">
                  <X className="w-4 h-4" /> {A.reset}
                </button>
              )}
              <button onClick={handleReload} disabled={loading} className="p-2 border border-border rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 text-foreground" title={A.refresh}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm">
                <Plus className="w-4 h-4" /> {A.add}
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder={A.carsSearchPlaceholder}
              className="w-full pl-10 pr-10 py-2.5 bg-card border border-border text-foreground placeholder:text-muted-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {(hasActiveFilters(filters) || searchQuery) && (
            <div className="flex flex-wrap gap-1.5">
              {searchQuery && (
                <span className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {A.searchLabel} «{searchQuery}» <button onClick={() => setSearchQuery('')}><X className="w-3 h-3" /></button>
                </span>
              )}
              {filters.status && (
                <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${CAR_STATUS_COLORS[filters.status]}`}>
                  {carStatusLabels[filters.status]} <button onClick={() => setFilters(f => ({ ...f, status: '' }))}><X className="w-3 h-3" /></button>
                </span>
              )}
              {(filters.priceMin || filters.priceMax) && (
                <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {A.priceChip} {filters.priceMin || '0'} – {filters.priceMax || '∞'} ₽
                  <button onClick={() => setFilters(f => ({ ...f, priceMin: '', priceMax: '' }))}><X className="w-3 h-3" /></button>
                </span>
              )}
              {(filters.mileageMin || filters.mileageMax) && (
                <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {A.mileageChip} {filters.mileageMin || '0'} – {filters.mileageMax || '∞'} {lang === 'ru' ? 'км' : 'km'}
                  <button onClick={() => setFilters(f => ({ ...f, mileageMin: '', mileageMax: '' }))}><X className="w-3 h-3" /></button>
                </span>
              )}
              {(filters.yearMin || filters.yearMax) && (
                <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {A.yearChip} {filters.yearMin || '–'} – {filters.yearMax || '–'}
                  <button onClick={() => setFilters(f => ({ ...f, yearMin: '', yearMax: '' }))}><X className="w-3 h-3" /></button>
                </span>
              )}
              {filters.brands.map(b => (
                <span key={b} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {b} <button onClick={() => setFilters(f => ({ ...f, brands: f.brands.filter(x => x !== b), models: [], selectedGenIds: [], selectedConfIds: [], selectedModifIds: [] }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.models.map(m => (
                <span key={m} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {m} <button onClick={() => setFilters(f => ({ ...f, models: f.models.filter(x => x !== m), selectedGenIds: [], selectedConfIds: [], selectedModifIds: [] }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.selectedGenIds.map(id => (
                <span key={id} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {availableGens.find(g => g.id === id)?.name ?? A.generationFilter}
                  <button onClick={() => setFilters(f => ({ ...f, selectedGenIds: f.selectedGenIds.filter(x => x !== id), selectedConfIds: [], selectedModifIds: [] }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.selectedConfIds.map(id => (
                <span key={id} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {availableConfs.find(c => c.id === id)?.name ?? A.configFilter}
                  <button onClick={() => setFilters(f => ({ ...f, selectedConfIds: f.selectedConfIds.filter(x => x !== id), selectedModifIds: [] }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.selectedModifIds.map(id => (
                <span key={id} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {availableModifs.find(m => m.id === id)?.name ?? A.modifFilter}
                  <button onClick={() => setFilters(f => ({ ...f, selectedModifIds: f.selectedModifIds.filter(x => x !== id) }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.transmissions.map(t => (
                <span key={t} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {T.transmission[t]} <button onClick={() => setFilters(f => ({ ...f, transmissions: f.transmissions.filter(x => x !== t) }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.fuelTypes.map(ft => (
                <span key={ft} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {T.fuel[ft]} <button onClick={() => setFilters(f => ({ ...f, fuelTypes: f.fuelTypes.filter(x => x !== ft) }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {filters.bodyTypes.map(bt => (
                <span key={bt} className="flex items-center gap-1 text-xs bg-secondary text-foreground px-2.5 py-1 rounded-full">
                  {T.body[bt]} <button onClick={() => setFilters(f => ({ ...f, bodyTypes: f.bodyTypes.filter(x => x !== bt) }))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {loading && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {A.loading}
                </span>
              )}
            </div>
          )}
        </div>

        {filtersOpen && (
          <div className="lg:hidden">
            <CarFilterPanel filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_FILTERS)}
              availableBrands={availableBrands} brandsLoading={marks.length === 0}
              availableModels={availableModels} modelsLoading={modelsLoading}
              availableGens={availableGens} availableConfs={availableConfs} availableModifs={availableModifs} />
          </div>
        )}

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary border-b border-border">
                <tr>{[A.carsTableCar, A.carsTableYear, A.carsTablePrice, A.carsTableMileage, A.carsTableStatus, A.carsTableActions].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && allCars.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
                ) : displayCars.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {hasActiveFilters(filters) || searchQuery ? A.noResults : A.carsEmpty}
                  </td></tr>
                ) : displayCars.map((car) => (
                  <CarTableRow key={car.id} car={car} onEdit={openEdit} onDelete={handleDelete}
                    onStatusChange={handleStatusChange} onRowClick={id => navigate(`/car/${id}`)}
                    carStatusLabels={carStatusLabels} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div ref={sentinelRef} className="mt-2">
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!hasMore && filteredCars.length > 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">
              {A.allLoadedPrefix} {filteredCars.length} {A.allLoadedSuffix}
            </p>
          )}
        </div>
      </div>

      {deleteModal && (
        <Modal title={A.deleteCarTitle} onClose={() => setDeleteModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {A.deleteCarConfirm}{' '}
              <span className="font-semibold text-foreground">{deleteModal.name}</span>?{' '}
              {A.deleteCarNote}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">{A.cancel}</button>
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 px-4 py-2 bg-destructive text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {A.delete}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showForm && (
        <Modal title={editCar ? A.carFormEdit : A.carFormCreate} onClose={() => setShowForm(false)} size="lg">
          <form onSubmit={handleSave} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Create mode: catalog cascade Mark → Model → Generation → Configuration → Modification */}
            {!editCar && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormBrand} *</label>
                  <FormSearchSelect
                    options={marks} value={formMarkId} onChange={onFormMarkChange}
                    getLabel={(m) => m.name ?? m.cyrillic_name ?? m.id}
                    placeholder={T.listing.chooseMark} searchPlaceholder={T.listing.searchPlaceholder}
                    noResults={T.listing.noResults} loading={marks.length === 0 && marksLoading} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormModel} *</label>
                  <FormSearchSelect
                    options={formModels} value={formModelId} onChange={onFormModelChange}
                    getLabel={(m) => m.name ?? m.id}
                    placeholder={formMarkId ? T.listing.chooseModel : T.listing.firstChooseMark}
                    searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                    disabled={!formMarkId} loading={fmLoading} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.generation} *</label>
                  <FormSearchSelect
                    options={formGens} value={formGenId} onChange={onFormGenChange}
                    getLabel={(g) => g.name ?? `${g.year_from ?? ''}–${g.year_to ?? '...'}`}
                    placeholder={formModelId ? T.listing.chooseGeneration : T.listing.firstChooseModel}
                    searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                    disabled={!formModelId} loading={fgLoading} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.configuration} *</label>
                  <FormSearchSelect
                    options={formConfs} value={formConfId} onChange={onFormConfChange}
                    getLabel={(c) => c.name ?? c.id}
                    placeholder={formGenId ? T.listing.chooseConfiguration : T.listing.firstChooseGeneration}
                    searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                    disabled={!formGenId} loading={fcLoading} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.modification} *</label>
                  <FormSearchSelect
                    options={formMods} value={formModId} onChange={setFormModId}
                    getLabel={(m) => m.name ?? m.group_name ?? m.id}
                    placeholder={formConfId ? T.listing.chooseModification : T.listing.firstChooseConfiguration}
                    searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                    disabled={!formConfId} loading={fmoLoading} />
                </div>
              </div>
            )}

            {/* Edit mode: cascade dropdowns for brand/model */}
            {editCar && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormBrand}</label>
                  <FormSearchSelect
                    options={marks} value={formMarkId} onChange={onFormMarkChange}
                    getLabel={(m) => m.name ?? m.cyrillic_name ?? m.id}
                    placeholder={T.listing.chooseMark} searchPlaceholder={T.listing.searchPlaceholder}
                    noResults={T.listing.noResults} loading={marks.length === 0 && marksLoading} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormModel}</label>
                  <FormSearchSelect
                    options={formModels} value={formModelId} onChange={onFormModelChange}
                    getLabel={(m) => m.name ?? m.id}
                    placeholder={formMarkId ? T.listing.chooseModel : T.listing.firstChooseMark}
                    searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                    disabled={!formMarkId} loading={fmLoading} />
                </div>
                {formGens.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.generation}</label>
                    <FormSearchSelect
                      options={formGens} value={formGenId} onChange={onFormGenChange}
                      getLabel={(g) => g.name ?? `${g.year_from ?? ''}–${g.year_to ?? '...'}`}
                      placeholder={T.listing.chooseGeneration}
                      searchPlaceholder={T.listing.searchPlaceholder} noResults={T.listing.noResults}
                      loading={fgLoading} />
                  </div>
                )}
              </div>
            )}

            {/* Year / Price / Mileage — common fields */}
            <div className="grid grid-cols-3 gap-3">
              {([
                ['year', A.carFormYear, 'number', true],
                ['price', A.carFormPrice, 'number', true],
                ['mileage', A.carFormMileage, 'number', false],
              ] as const).map(([key, label, type, required]) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{label}</label>
                  <input type={type} required={required} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inputCls} />
                </div>
              ))}
            </div>

            {/* Create mode: full CreateListingPage-style fields */}
            {!editCar && (
              <div className="space-y-4">
                {/* Condition */}
                <div>
                  <label className="block text-xs font-semibold mb-2 text-muted-foreground">{T.listing.condition} *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {T.listing.conditionOptions.map((opt: { value: string; label: string; desc: string }) => (
                      <button key={opt.value} type="button" onClick={() => setFormCondition(opt.value)}
                        className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${formCondition === opt.value ? 'bg-primary/10 border-primary text-primary' : 'bg-secondary border-border text-foreground hover:bg-secondary/80'}`}>
                        <span className="text-xs font-semibold">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormColor} *</label>
                  <FormSearchSelect
                    options={colors} value={formColorId}
                    onChange={id => setFormColorId(id)}
                    getLabel={c => c.name_ru}
                    placeholder={T.listing.chooseColor}
                    searchPlaceholder={T.listing.searchPlaceholder}
                    noResults={T.listing.noResults} />
                </div>

                {/* City */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.city}</label>
                  <FormSearchSelect
                    options={cities} value={formCityId}
                    onChange={id => setFormCityId(id)}
                    getLabel={c => c.name_ru}
                    placeholder={T.listing.chooseCity}
                    searchPlaceholder={T.listing.searchPlaceholder}
                    noResults={T.listing.noResults} />
                </div>

                {/* VIN + License Plate */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormVin}</label>
                    <input type="text" maxLength={17} value={formVin} onChange={e => setFormVin(e.target.value.toUpperCase())} className={inputCls} placeholder="WBAXXXXXXXXXXXXXXX" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.plate}</label>
                    <input type="text" value={formLicensePlate} onChange={e => setFormLicensePlate(e.target.value.toUpperCase())} className={inputCls} placeholder={T.listing.platePlaceholder} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">{T.listing.identifierError}</p>

                {/* Payment methods */}
                <div>
                  <label className="block text-xs font-semibold mb-2 text-muted-foreground">{T.listing.paymentMethods} *</label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div onClick={() => setFormAcceptsCash(v => !v)}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${formAcceptsCash ? 'bg-primary border-primary' : 'border-border'}`}>
                        {formAcceptsCash && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm text-foreground">{T.listing.cash}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div onClick={() => setFormAcceptsTransfer(v => !v)}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${formAcceptsTransfer ? 'bg-primary border-primary' : 'border-border'}`}>
                        {formAcceptsTransfer && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm text-foreground">{T.listing.transfer}</span>
                    </label>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormDescription}</label>
                  <textarea value={form.description} rows={3} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={inputCls + ' resize-none'} />
                </div>

                {/* Viewing schedule */}
                <div className="pt-2 border-t border-border">
                  <p className="text-sm font-semibold text-foreground mb-1">{A.carFormViewings}</p>
                  <p className="text-xs text-muted-foreground mb-3">{T.listing.viewingDaysDesc}</p>
                  <div className="space-y-3">
                    <div>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEK_DAYS.map((day, idx) => {
                          const active = formViewingDays.includes(idx);
                          return (
                            <button key={day} type="button"
                              onClick={() => setFormViewingDays(prev => active ? prev.filter(d => d !== idx) : [...prev, idx])}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:bg-secondary/80'}`}>
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {formViewingDays.length > 0 && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormTimeFrom}</label>
                            <select value={formViewingFrom} onChange={e => setFormViewingFrom(e.target.value)} className={selectCls}>
                              {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormTimeTo}</label>
                            <select value={formViewingTo} onChange={e => setFormViewingTo(e.target.value)} className={selectCls}>
                              {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-muted-foreground">{T.listing.saleAddress} *</label>
                          <input type="text" placeholder={T.listing.saleAddressPlaceholder} value={formSaleAddress} onChange={e => setFormSaleAddress(e.target.value)} className={inputCls} />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Photos */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormPhotos}</label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:bg-secondary/30 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('car-images-input')?.click()}
                    onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
                    <input id="car-images-input" type="file" multiple accept="image/*" className="hidden" onChange={handleFilesChange} />
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{A.carFormPhotosDrop}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">{A.carFormPhotosTypes}</p>
                  </div>
                  {previews.length > 0 && (
                    <>
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        {previews.map((src, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-secondary group">
                            <img src={src} alt="" className="w-full h-full object-cover" />
                            <button type="button" onClick={() => removeFile(i)}
                              className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={clearFiles} className="text-xs text-destructive hover:underline mt-2">{A.carFormClearPhotosPrefix} ({previews.length})</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Edit mode: keep old fields */}
            {editCar && (
              <div className="space-y-4">
                {editLoading && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> {A.loading}
                  </div>
                )}

                {/* Color selector */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormColor}</label>
                  <FormSearchSelect
                    options={colors} value={formColorId}
                    onChange={id => setFormColorId(id)}
                    getLabel={c => lang === 'en' ? (c.name_en ?? c.name_ru) : c.name_ru}
                    placeholder={T.listing.chooseColor}
                    searchPlaceholder={T.listing.searchPlaceholder}
                    noResults={T.listing.noResults} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['engine_volume', A.carFormVolume, 'number'],
                    ['engine_power', A.carFormPower, 'number'],
                    ['vin', A.carFormVin, 'text'],
                  ] as const).map(([key, label, type]) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">{label}</label>
                      <input type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inputCls} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormFuel}</label>
                    <select value={form.fuel_type} onChange={e => setForm(p => ({ ...p, fuel_type: e.target.value }))} className={selectCls}>
                      <option value="">{A.carFormNotSpecified}</option>
                      {Object.entries(T.fuel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormGearbox}</label>
                    <select value={form.transmission} onChange={e => setForm(p => ({ ...p, transmission: e.target.value }))} className={selectCls}>
                      <option value="">{A.carFormNotSpecified}</option>
                      {Object.entries(T.transmission).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormBody}</label>
                    <select value={form.body_type} onChange={e => setForm(p => ({ ...p, body_type: e.target.value }))} className={selectCls}>
                      <option value="">{A.carFormNotSpecified}</option>
                      {Object.entries(T.body).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>

                {/* Existing photos */}
                {existingImages.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold mb-2 text-muted-foreground">{A.carFormPhotos}</label>
                    <div className="grid grid-cols-4 gap-2">
                      {existingImages.map((src, i) => (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          {i === 0 && (
                            <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                              {lang === 'en' ? 'Main' : 'Главное'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormPhotos}</label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:bg-secondary/30 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('car-images-input')?.click()}
                    onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
                    <input id="car-images-input" type="file" multiple accept="image/*" className="hidden" onChange={handleFilesChange} />
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{A.carFormPhotosDrop}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">{A.carFormPhotosTypes}</p>
                  </div>
                  {previews.length > 0 && (
                    <>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {previews.map((src, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-secondary group">
                            <img src={src} alt="" className="w-full h-full object-cover" />
                            <button type="button" onClick={() => removeFile(i)}
                              className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={clearFiles} className="text-xs text-destructive hover:underline mt-2">{A.carFormClearPhotosPrefix} ({previews.length})</button>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormDescription}</label>
                  <textarea value={form.description} rows={3} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={inputCls + ' resize-none'} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 text-muted-foreground">{T.listing.condition}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {T.listing.conditionOptions.map((opt: { value: string; label: string; desc: string }) => (
                      <button key={opt.value} type="button" onClick={() => setFormCondition(opt.value)}
                        className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${formCondition === opt.value ? 'bg-primary/10 border-primary text-primary' : 'bg-secondary border-border text-foreground hover:bg-secondary/80'}`}>
                        <span className="text-xs font-semibold">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-2 border-t border-border">
                  <p className="text-sm font-semibold text-foreground mb-3">{A.carFormViewings}</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-muted-foreground">{A.carFormViewingDays}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEK_DAYS.map(day => {
                          const active = form.viewing_days.includes(day);
                          return (
                            <button key={day} type="button"
                              onClick={() => setForm(p => ({ ...p, viewing_days: active ? p.viewing_days.filter(d => d !== day) : [...p.viewing_days, day] }))}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:bg-secondary/80'}`}>
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormTimeFrom}</label>
                        <input type="time" value={form.viewing_time_from} onChange={e => setForm(p => ({ ...p, viewing_time_from: e.target.value }))} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormTimeTo}</label>
                        <input type="time" value={form.viewing_time_to} onChange={e => setForm(p => ({ ...p, viewing_time_to: e.target.value }))} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.carFormViewingAddress}</label>
                      <input type="text" placeholder={A.carFormViewingAddressPlaceholder} value={form.viewing_address} onChange={e => setForm(p => ({ ...p, viewing_address: e.target.value }))} className={inputCls} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2 sticky bottom-0 bg-card/95 backdrop-blur py-2 border-t border-border">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80 transition-colors">{A.cancel}</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : editCar ? A.save : A.add}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// OffersTab

function OffersTab({ onPendingCountChange }: { onPendingCountChange?: (n: number) => void }) {
  const { T, lang } = useLanguage();
  const A = T.admin;
  const offerStatusLabels = A.offerStatus;

  const [offers, setOffers] = useState<AdminCarOffer[]>([]);
  const [resolvedOffers, setResolvedOffers] = useState<AdminCarOffer[]>([]);
  const [count, setCount] = useState(0); const [skip, setSkip] = useState(0);
  const [filterStatus, setFilterStatus] = useState<CarOfferStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [approveModal, setApproveModal] = useState<{ id: string; brand: string; model: string } | null>(null);
  const [rejectModal,  setRejectModal]  = useState<{ id: string; brand: string; model: string } | null>(null);
  const [revokeModal,  setRevokeModal]  = useState<{ id: string; brand: string; model: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminCarOffer[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const searchAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await adminApi.getOffers(filterStatus || undefined, skip);
      setOffers(data.data); setCount(data.count);
      if (!filterStatus || filterStatus === 'pending') {
        const pendingCount = filterStatus === 'pending' ? data.count : data.data.filter((o: AdminCarOffer) => o.status === 'pending').length;
        onPendingCountChange?.(pendingCount);
      }
    }
    catch { toast.error(A.offersLoadError); } finally { setLoading(false); }
  }, [skip, filterStatus, searchQuery, A.offersLoadError, onPendingCountChange]);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    searchAbortRef.current = new AbortController();
    try {
      const data = await adminApi.getOffers(filterStatus || undefined, 0);
      const q = query.toLowerCase();
      setSearchResults(data.data.filter((o: AdminCarOffer) =>
        o.brand.toLowerCase().includes(q) || o.model.toLowerCase().includes(q) ||
        String(o.year).includes(q) || String(o.price).includes(q)
      ));
    } catch (err) { if ((err as Error).name !== 'AbortError') { toast.error(A.searchError); setSearchResults([]); } }
    finally { setSearchLoading(false); }
  }, [filterStatus, A.searchError]);

  useEffect(() => { performSearch(debouncedSearch); }, [debouncedSearch, performSearch]);
  useEffect(() => { load(); }, [load]);
  const clearSearch = () => { setSearchQuery(''); setSearchResults([]); setSkip(0); };

  const handleApprove = async () => {
    if (!approveModal) return;
    const id = approveModal.id;
    setProcessing(id);
    try {
      await adminApi.reviewOffer(id, 'approved');
      toast.success(A.approvedSuccess);
      setApproveModal(null);
      setOffers(prev => {
        const found = prev.find(o => o.id === id);
        if (found) setResolvedOffers(r => [{ ...found, status: 'approved' as CarOfferStatus }, ...r]);
        const next = prev.filter(o => o.id !== id);
        onPendingCountChange?.(next.length);
        return next;
      });
      setSearchResults(prev => prev.map(o => o.id === id ? { ...o, status: 'approved' as CarOfferStatus } : o));
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : A.error); }
    finally { setProcessing(null); }
  };
  const handleReject = async () => {
    if (!rejectModal) return;
    const id = rejectModal.id;
    const reason = rejectReason || undefined;
    const reasonOrNull = rejectReason || null;
    setProcessing(id);
    try {
      await adminApi.reviewOffer(id, 'rejected', reason);
      toast.success(A.rejectedSuccess);
      setRejectModal(null);
      setRejectReason('');
      setOffers(prev => {
        const found = prev.find(o => o.id === id);
        if (found) setResolvedOffers(r => [{ ...found, status: 'rejected' as CarOfferStatus, rejection_reason: reasonOrNull }, ...r]);
        const next = prev.filter(o => o.id !== id);
        onPendingCountChange?.(next.length);
        return next;
      });
      setSearchResults(prev => prev.map(o => o.id === id ? { ...o, status: 'rejected' as CarOfferStatus, rejection_reason: reasonOrNull } : o));
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : A.error); }
    finally { setProcessing(null); }
  };

  const handleRevoke = async () => {
    if (!revokeModal) return;
    const id = revokeModal.id;
    setProcessing(id);
    try {
      await adminApi.deleteListing(id);
      toast.success(A.revokedSuccess);
      setRevokeModal(null);
      setResolvedOffers(prev => prev.map(o => o.id === id
        ? { ...o, status: 'rejected' as CarOfferStatus, rejection_reason: A.revokeReason }
        : o));
      setSearchResults(prev => prev.map(o => o.id === id
        ? { ...o, status: 'rejected' as CarOfferStatus, rejection_reason: A.revokeReason }
        : o));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : A.error);
    } finally {
      setProcessing(null);
    }
  };

  const isSearching = searchQuery.trim().length > 0;
  const allLocalOffers = [...resolvedOffers, ...offers];
  const displayedOffers = isSearching
    ? searchResults
    : filterStatus ? allLocalOffers.filter(o => o.status === filterStatus) : allLocalOffers;
  const displayedCount = isSearching ? searchResults.length : (filterStatus ? displayedOffers.length : resolvedOffers.length + count);
  if (loading && offers.length === 0 && !isSearching) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold text-foreground">{A.offersTitle} <span className="text-muted-foreground text-lg font-normal">({displayedCount})</span></h2>
          <div className="flex gap-2">
            {filterStatus && (
              <button onClick={() => { setFilterStatus(''); setSkip(0); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 text-destructive rounded-lg text-sm hover:bg-destructive/20 transition-colors">
                <X className="w-4 h-4" /> {A.reset}
              </button>
            )}
            <button onClick={isSearching ? clearSearch : load} className="p-2 border border-border rounded-lg hover:bg-secondary transition-colors text-foreground" title={isSearching ? A.clearSearch : A.refresh}>
              {isSearching ? <X className="w-4 h-4" /> : <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={A.offersSearchPlaceholder}
            className="w-full pl-10 pr-10 py-2.5 bg-card border border-border text-foreground placeholder:text-muted-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
          {searchQuery && <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 bg-secondary/50 rounded-lg px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{A.statusLabel}</span>
            <button onClick={() => { setFilterStatus(''); setSkip(0); }}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${!filterStatus ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
              {A.all}
            </button>
            {(['pending', 'approved', 'rejected'] as CarOfferStatus[]).map(s => (
              <button key={s} onClick={() => { setFilterStatus(filterStatus === s ? '' : s); setSkip(0); }}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${filterStatus === s ? `${OFFER_STATUS_COLORS[s]} ring-2 ring-offset-1 ring-primary/20` : 'text-muted-foreground bg-secondary hover:bg-secondary/80'}`}>
                {offerStatusLabels[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {displayedOffers.length === 0 && !searchLoading && <EmptyTableState text={isSearching ? A.noResults : A.offersEmpty} />}
        {displayedOffers.map(offer => {
          const primaryImg = offer.images.find((i: { is_primary: boolean }) => i.is_primary) ?? offer.images[0];
          return (
            <div key={offer.id} className="bg-card rounded-xl border border-border p-4">
              <div className="flex gap-4">
                {primaryImg && <div className="w-24 rounded-lg overflow-hidden flex-shrink-0 bg-secondary"><img src={primaryImg.thumbnail_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <h3 className="font-semibold text-foreground">{offer.brand} {offer.model} {offer.year}</h3>
                      <p className="text-sm text-muted-foreground">{formatPrice(offer.price, lang)} • {formatMileage(offer.mileage, lang)} • {offer.images.length} {A.photoCount}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(offer.created_at, lang)}</p>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${OFFER_STATUS_COLORS[offer.status]}`}>{offerStatusLabels[offer.status]}</span>
                  </div>
                  {offer.rejection_reason && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{offer.rejection_reason}</p>}
                  {offer.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setApproveModal({ id: offer.id, brand: offer.brand, model: offer.model })} disabled={processing === offer.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50">{processing === offer.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {A.approve}</button>
                      <button onClick={() => setRejectModal({ id: offer.id, brand: offer.brand, model: offer.model })} disabled={processing === offer.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 text-destructive rounded-lg text-sm hover:bg-destructive/20 disabled:opacity-50"><X className="w-3.5 h-3.5" /> {A.reject}</button>
                    </div>
                  )}
                  {offer.status === 'approved' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => setRevokeModal({ id: offer.id, brand: offer.brand, model: offer.model })}
                        disabled={processing === offer.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30 rounded-lg text-sm hover:bg-yellow-500/20 transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:scale-100">
                        {processing === offer.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {A.revoke}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!isSearching && <Pagination skip={skip} limit={20} count={count} onChange={setSkip} ofLabel={A.paginationOf} />}
      {approveModal && (
        <Modal title={A.approveTitle} onClose={() => setApproveModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {A.approveConfirm}{' '}
              <span className="font-semibold text-foreground">{approveModal.brand} {approveModal.model}</span>?{' '}
              {A.approveNote}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setApproveModal(null)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">{A.cancel}</button>
              <button onClick={handleApprove} disabled={!!processing} className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {A.publish}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {rejectModal && (
        <Modal title={`${A.rejectTitle} ${rejectModal.brand} ${rejectModal.model}`} onClose={() => setRejectModal(null)}>
          <div className="space-y-4">
            <div><label className="block text-sm font-semibold mb-2 text-foreground">{A.rejectReason}</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4} className={inputCls + ' resize-none'} /></div>
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">{A.cancel}</button>
              <button onClick={handleReject} disabled={!!processing} className="flex-1 px-4 py-2 bg-destructive text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50">{processing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : A.reject}</button>
            </div>
          </div>
        </Modal>
      )}
      {revokeModal && (
        <Modal title={`${A.revokeTitle} ${revokeModal.brand} ${revokeModal.model}`} onClose={() => setRevokeModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {A.revokeConfirm}{' '}
              <span className="font-semibold text-foreground">{revokeModal.brand} {revokeModal.model}</span>{' '}
              {A.revokeNote}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRevokeModal(null)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">{A.cancel}</button>
              <button onClick={handleRevoke} disabled={!!processing}
                className="flex-1 flex justify-center items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {A.revoke}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// MessagesTab

function MessagesTab() {
  const { T, lang } = useLanguage();
  const A = T.admin;
  const msgStatusLabels = A.msgStatus;

  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [count, setCount] = useState(0);
  const [skip, setSkip] = useState(0);
  const [filterStatus, setFilterStatus] = useState<MessageStatus | ''>('open');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  const load = useCallback(async () => {
    if (searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await adminApi.getMessages(filterStatus || undefined, skip);
      setMessages(data.data); setCount(data.count);
    } catch { toast.error(A.ticketsLoadError); }
    finally { setLoading(false); }
  }, [skip, filterStatus, searchQuery, A.ticketsLoadError]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: MessageStatus) => {
    setProcessing(id);
    try {
      await adminApi.updateMessage(id, { status });
      toast.success(A.statusUpdated);
      load();
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : A.error); }
    finally { setProcessing(null); }
  };

  const clearSearch = () => { setSearchQuery(''); setSkip(0); };

  const filteredMessages = useMemo(() => {
    const result = filterStatus ? messages.filter(m => m.status === filterStatus) : messages;
    if (!debouncedSearch.trim()) return result;
    const q = debouncedSearch.toLowerCase();
    return result.filter(m =>
      (m.subject && m.subject.toLowerCase().includes(q)) ||
      m.body.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (m.phone && m.phone.toLowerCase().includes(q))
    );
  }, [messages, debouncedSearch, filterStatus]);

  const displayedMessages = filteredMessages;
  const hasActiveFilter = !!filterStatus;
  if (loading && messages.length === 0) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold text-foreground">
            {A.ticketsTitle} <span className="text-muted-foreground text-lg font-normal">({debouncedSearch ? filteredMessages.length : count})</span>
          </h2>
          <div className="flex gap-2">
            {hasActiveFilter && (
              <button onClick={() => { setFilterStatus(''); setSkip(0); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 text-destructive rounded-lg text-sm hover:bg-destructive/20 transition-colors">
                <X className="w-4 h-4" /> {A.reset}
              </button>
            )}
            <button onClick={searchQuery ? clearSearch : load}
              className="p-2 border border-border rounded-lg hover:bg-secondary transition-colors text-foreground" title={searchQuery ? A.clearSearch : A.refresh}>
              {searchQuery ? <X className="w-4 h-4" /> : <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={A.ticketsSearchPlaceholder}
            className="w-full pl-10 pr-10 py-2.5 bg-card border border-border text-foreground placeholder:text-muted-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
          {searchQuery && (
            <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 bg-secondary/50 rounded-lg px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{A.statusLabel}</span>
            <button onClick={() => { setFilterStatus(''); setSkip(0); }}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${!filterStatus ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
              {A.all}
            </button>
            {(['open', 'in_progress', 'resolved', 'closed'] as MessageStatus[]).map(s => (
              <button key={s} onClick={() => { setFilterStatus(filterStatus === s ? '' : s); setSkip(0); }}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${filterStatus === s ? `${MSG_STATUS_COLORS[s]} ring-2 ring-offset-1 ring-primary/20` : 'text-muted-foreground bg-secondary hover:bg-secondary/80'}`}>
                {msgStatusLabels[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {displayedMessages.length === 0 && <EmptyTableState text={debouncedSearch ? A.noResults : A.ticketsEmpty} />}
        {displayedMessages.map(msg => (
          <div key={msg.id} className="bg-card rounded-xl border border-border overflow-hidden">
            <button onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-secondary/50 transition-colors text-left">
              <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${MSG_STATUS_COLORS[msg.status]}`}>{msgStatusLabels[msg.status]}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{msg.subject ?? msg.message_type}</p>
                <p className="text-xs text-muted-foreground">{msg.name} • {msg.email} • {formatDate(msg.created_at, lang)}</p>
              </div>
            </button>
            {expanded === msg.id && (
              <div className="px-4 pb-4 border-t border-border">
                <p className="text-sm mt-3 text-muted-foreground leading-relaxed">{msg.body}</p>
                {msg.phone && <p className="text-sm mt-2 text-foreground"><span className="font-medium">{A.phoneLabel}</span> {msg.phone}</p>}
                <div className="flex gap-2 mt-4 flex-wrap">
                  {(['open', 'in_progress', 'resolved', 'closed'] as MessageStatus[]).map(s => (
                    <button key={s} onClick={() => handleStatusChange(msg.id, s)} disabled={msg.status === s || processing === msg.id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${msg.status === s ? `${MSG_STATUS_COLORS[s]} cursor-default` : 'bg-secondary text-foreground hover:bg-secondary/80'}`}>
                      {processing === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : msgStatusLabels[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination skip={skip} limit={20} count={count} onChange={setSkip} ofLabel={A.paginationOf} />
    </div>
  );
}

// UsersTab

function UsersTab() {
  const { T, lang } = useLanguage();
  const A = T.admin;
  const userRoleLabels = A.userRole;
  const userStatusLabels = A.userStatus;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [count, setCount] = useState(0); const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserCreate & { status?: UserStatus }>({ full_name: '', email: '', password: '', role: 'manager' });
  const [saving, setSaving] = useState(false);
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [filterStatus, setFilterStatus] = useState<UserStatus | ''>('');
  const [filterRole, setFilterRole] = useState<UserRole | ''>('');

  const load = useCallback(async () => {
    if (searchQuery.trim()) return; setLoading(true);
    try {
      const data = await adminApi.getUsers(skip);
      let filtered = data.data;
      if (filterStatus) filtered = filtered.filter((u: AdminUser) => u.status === filterStatus);
      if (filterRole) filtered = filtered.filter((u: AdminUser) => u.role === filterRole);
      setUsers(filtered); setCount(filtered.length);
    } catch { toast.error(A.usersLoadError); } finally { setLoading(false); }
  }, [skip, searchQuery, filterStatus, filterRole, A.usersLoadError]);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    searchAbortRef.current = new AbortController();
    try {
      const data = await adminApi.getUsers(0); const q = query.toLowerCase();
      let results = data.data.filter((u: AdminUser) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone && u.phone.toLowerCase().includes(q)));
      if (filterStatus) results = results.filter((u: AdminUser) => u.status === filterStatus);
      if (filterRole) results = results.filter((u: AdminUser) => u.role === filterRole);
      setSearchResults(results);
    } catch (err) { if ((err as Error).name !== 'AbortError') { toast.error(A.searchError); setSearchResults([]); } }
    finally { setSearchLoading(false); }
  }, [filterStatus, filterRole, A.searchError]);

  useEffect(() => { performSearch(debouncedSearch); }, [debouncedSearch, performSearch]);
  useEffect(() => { load(); }, [load]);
  const clearSearch = () => { setSearchQuery(''); setSearchResults([]); setSkip(0); };

  const openCreate = () => { setEditUser(null); setForm({ full_name: '', email: '', password: '', role: 'manager' }); setShowForm(true); };
  const openEdit = (u: AdminUser) => { setEditUser(u); setForm({ full_name: u.full_name, email: u.email, password: '', role: u.role, status: u.status }); setShowForm(true); };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editUser) {
        const body: Record<string, unknown> = { full_name: form.full_name, email: form.email, role: form.role, status: form.status };
        if (form.password) body.password = form.password;
        await adminApi.updateUser(editUser.id, body); toast.success(A.userUpdated);
      } else { await adminApi.createUser({ full_name: form.full_name, email: form.email, password: form.password, role: form.role }); toast.success(A.userCreated); }
      setShowForm(false); if (searchQuery.trim()) performSearch(searchQuery); else load();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : A.error); }
    finally { setSaving(false); }
  };

  const handleDelete = async (u: AdminUser) => {
    if (u.id === currentUser?.id) { toast.error(A.cannotDeleteSelf); return; }
    if (!confirm(`${A.delete} "${u.full_name}"?`)) return;
    try { await adminApi.deleteUser(u.id); toast.success(A.userDeleted); if (searchQuery.trim()) performSearch(searchQuery); else load(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : A.error); }
  };

  const isSearching = searchQuery.trim().length > 0;
  const hasActiveFilters = filterStatus || filterRole;
  const displayedUsers = isSearching ? searchResults : users;
  const displayedCount = isSearching ? searchResults.length : count;
  if (loading && users.length === 0 && !isSearching) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold text-foreground">{A.usersTitle} <span className="text-muted-foreground text-lg font-normal">({displayedCount})</span></h2>
          <div className="flex gap-2 flex-wrap">
            {hasActiveFilters && (
              <button onClick={() => { setFilterStatus(''); setFilterRole(''); setSkip(0); }} className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 text-destructive rounded-lg text-sm hover:bg-destructive/20 transition-colors">
                <X className="w-4 h-4" /> {A.reset}
              </button>
            )}
            <button onClick={isSearching ? clearSearch : load} className="p-2 border border-border rounded-lg hover:bg-secondary transition-colors text-foreground">
              {isSearching ? <X className="w-4 h-4" /> : <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            </button>
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm">
              <Plus className="w-4 h-4" /> {A.add}
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={A.usersSearchPlaceholder}
            className="w-full pl-10 pr-10 py-2.5 bg-card border border-border text-foreground placeholder:text-muted-foreground rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
          {searchQuery && <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 bg-secondary/50 rounded-lg px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{A.statusLabel}</span>
            <button onClick={() => setFilterStatus('')} className={`text-xs px-2 py-0.5 rounded-full transition-colors ${!filterStatus ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{A.all}</button>
            {(['active', 'inactive', 'banned'] as UserStatus[]).map(s => (
              <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${filterStatus === s ? `${USER_STATUS_COLORS[s]} ring-2 ring-offset-1 ring-primary/20` : 'text-muted-foreground bg-secondary hover:bg-secondary/80'}`}>
                {userStatusLabels[s]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/50 rounded-lg px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{A.roleLabel}</span>
            <button onClick={() => setFilterRole('')} className={`text-xs px-2 py-0.5 rounded-full transition-colors ${!filterRole ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{A.all}</button>
            {(['admin', 'manager', 'support', 'user'] as UserRole[]).map(r => (
              <button key={r} onClick={() => setFilterRole(filterRole === r ? '' : r)}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${filterRole === r ? 'bg-primary text-primary-foreground ring-2 ring-offset-1 ring-primary/20' : 'text-muted-foreground bg-secondary hover:bg-secondary/80'}`}>
                {userRoleLabels[r]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary border-b border-border">
              <tr>{[A.usersTableName, A.usersTableEmail, A.usersTableRole, A.usersTableStatus, A.usersTableDate, A.usersTableActions].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-muted-foreground">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedUsers.length === 0 && !searchLoading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{isSearching ? A.noResults : A.usersEmpty}</td></tr>
              ) : displayedUsers.map(u => (
                <tr key={u.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3"><p className="font-semibold text-foreground">{u.full_name}</p>{u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{u.email}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-foreground font-medium">{userRoleLabels[u.role]}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${USER_STATUS_COLORS[u.status]}`}>{userStatusLabels[u.status]}</span></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(u.created_at, lang)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors"><Edit className="w-4 h-4 text-primary" /></button>
                      {u.id !== currentUser?.id && <button onClick={() => handleDelete(u)} className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-destructive" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!isSearching && <Pagination skip={skip} limit={20} count={count} onChange={setSkip} ofLabel={A.paginationOf} />}
      {showForm && (
        <Modal title={editUser ? A.userFormEdit : A.userFormCreate} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-3">
            {([
              ['full_name', A.userFormName, 'text', true],
              ['email', A.userFormEmail, 'email', true],
              ['password', editUser ? A.userFormPasswordEdit : A.userFormPasswordCreate, 'password', !editUser],
            ] as const).map(([key, label, type, required]) => (
              <div key={key}><label className="block text-xs font-semibold mb-1 text-muted-foreground">{label}</label>
                <input type={type} required={required as boolean} value={form[key as keyof typeof form] as string ?? ''} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inputCls} />
              </div>
            ))}
            <div><label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.userFormRole}</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))} className={selectCls}>
                {Object.entries(userRoleLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            {editUser && <div><label className="block text-xs font-semibold mb-1 text-muted-foreground">{A.userFormStatus}</label>
              <select value={form.status ?? 'active'} onChange={e => setForm(p => ({ ...p, status: e.target.value as UserStatus }))} className={selectCls}>
                <option value="active">{A.userStatusActive}</option>
                <option value="inactive">{A.userStatusInactive}</option>
                <option value="banned">{A.userStatusBanned}</option>
              </select></div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">{A.cancel}</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : editUser ? A.save : A.create}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Shared UI

function LoadingSpinner() {
  return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
}
function ErrorState({ message }: { message: string }) {
  return <div className="flex flex-col items-center justify-center py-16 text-center"><AlertCircle className="w-10 h-10 text-destructive mb-3" /><p className="text-muted-foreground">{message}</p></div>;
}
function EmptyTableState({ text }: { text: string }) {
  return <div className="bg-card rounded-xl border border-border py-12 text-center"><p className="text-muted-foreground">{text}</p></div>;
}

function Modal({ title, children, onClose, size = 'md' }: { title: string; children: React.ReactNode; onClose: () => void; size?: 'md' | 'lg' }) {
  const maxW = size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-card border border-border rounded-2xl p-6 w-full ${maxW} max-h-[90vh] overflow-y-auto shadow-xl`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Main Page

export function AdminPage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { T } = useLanguage();
  const A = T.admin;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabType) || 'stats';
  const setActiveTab = (tab: TabType) => setSearchParams({ tab }, { replace: true });
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [pendingOffersCount, setPendingOffersCount] = useState(0);

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'admin' && user.role !== 'manager'))) {
      toast.error(A.accessDenied); navigate('/');
    }
  }, [user, authLoading, navigate, A.accessDenied]);

  useEffect(() => {
    adminApi.getStats().then(setStats).catch(() => toast.error(A.statsLoadError)).finally(() => setStatsLoading(false));
    adminApi.getOffers('pending', 0).then(data => setPendingOffersCount(data.count)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  const tabs = [
    { id: 'stats' as TabType, label: A.tabStats, icon: BarChart3 },
    { id: 'cars' as TabType, label: A.tabCars, icon: Car, badge: stats?.active_listings },
    { id: 'offers' as TabType, label: A.tabOffers, icon: FileText, badge: pendingOffersCount },
    { id: 'messages' as TabType, label: A.tabMessages, icon: MessageSquare, badge: stats?.open_tickets },
    ...(user?.role === 'admin' ? [{ id: 'users' as TabType, label: A.tabUsers, icon: Users }] : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-foreground">{A.title}</h1>
          <p className="text-muted-foreground mt-1">{user?.full_name} • {user?.role === 'admin' ? A.adminRole : A.managerRole}</p>
        </div>
        <div className="flex gap-1 mb-6 bg-card border border-border rounded-xl p-1 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${isActive ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
                <Icon className="w-4 h-4" /> {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${isActive ? 'bg-background/20 text-background' : 'bg-destructive/10 text-destructive'}`}>{tab.badge}</span>
                )}
              </button>
            );
          })}
        </div>
        {activeTab === 'stats' && <StatsTab stats={stats} loading={statsLoading} />}
        {activeTab === 'cars' && <CarsTab />}
        {activeTab === 'offers' && <OffersTab onPendingCountChange={setPendingOffersCount} />}
        {activeTab === 'messages' && <MessagesTab />}
        {activeTab === 'users' && user?.role === 'admin' && <UsersTab />}
      </div>
    </div>
  );
}
