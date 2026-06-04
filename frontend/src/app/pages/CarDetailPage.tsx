import { useParams, Link, useNavigate } from 'react-router';
import { ArrowLeft, Heart, Share2, Phone, Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Loader2, CreditCard, CheckCircle, Banknote, ArrowRightLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { toast } from 'sonner';
import { useCar } from '../hooks/useCars';
import { useFavorites } from '../hooks/useFavorites';
import { viewingsApi, type ViewingWindow } from '../api/viewings';
import { reservationsApi } from '../api/reservations';
import { resolveCityName, catalogApi } from '../api/catalog';
import { useLanguage } from '../i18n/LanguageContext';

function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
}
function formatMileage(m: number, lang: string): string {
  return `${new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(m)} ${lang === 'ru' ? 'км' : 'km'}`;
}

// Только цвета/стили — не переводятся
const STATUS_COLORS: Record<string, string> = {
  available: 'bg-accent/15 text-accent border-accent/30',
  reserved: 'bg-primary/10 text-primary border-primary/30',
  sold: 'bg-muted text-muted-foreground border-border',
  inactive: 'bg-muted text-muted-foreground border-border',
};
const CONDITION_COLORS: Record<string, string> = {
  excellent: 'bg-accent/15 text-accent border-accent/30',
  good: 'bg-primary/10 text-primary border-primary/30',
  fair: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  poor: 'bg-destructive/10 text-destructive border-destructive/30',
};

function groupWindowsByDate(windows: ViewingWindow[]): Record<string, ViewingWindow[]> {
  return windows.reduce<Record<string, ViewingWindow[]>>((acc, w) => {
    const d = w.window_date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(w);
    return acc;
  }, {});
}

function formatWindowDate(dateStr: string, lang: string): string {
  // Append T00:00:00 so JS treats it as LOCAL midnight, not UTC (avoids off-by-one day)
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function CarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { car, loading, error } = useCar(id);
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const { lang, T } = useLanguage();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const [showBookingPanel, setShowBookingPanel] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);

  const [windows, setWindows] = useState<ViewingWindow[]>([]);
  const [windowsLoading, setWindowsLoading] = useState(false);
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);

  const [reserving, setReserving] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [reservationDone, setReservationDone] = useState(false);

  const [cityName, setCityName] = useState<string | null>(null);
  useEffect(() => {
    if (!car) return;
    if (car.city_name) { setCityName(car.city_name); return; }
    if (!car.city_id) return;
    resolveCityName(car.city_id).then(name => setCityName(name)).catch(() => {});
  }, [car]);

  const [colorName, setColorName] = useState<string | null>(null);
  useEffect(() => {
    if (!car?.color) return;
    catalogApi.getColors()
      .then(colors => {
        const found = colors.find(c => c.id === car.color);
        if (found) setColorName(found.name_ru);
      })
      .catch(() => {});
  }, [car?.color]);

  useEffect(() => {
    if (!id) return;
    setWindowsLoading(true);
    viewingsApi
      .getAvailableSlots(id)
      .then((data) => setWindows(data.filter((w) => w.is_available)))
      .catch(() => setWindows([]))
      .finally(() => setWindowsLoading(false));
  }, [id]);

  // Переводимые метки — вычисляются из T
  const TRANSMISSION_LABELS = T.transmission;
  const FUEL_LABELS = T.fuel;
  const BODY_LABELS = T.body;
  const STATUS_LABELS = T.status as Record<string, string>;
  const CONDITION_LABELS: Record<string, string> = {
    excellent: T.condition.excellent,
    good: T.condition.good,
    fair: T.condition.fair,
    poor: T.condition.poor,
  };
  const CONDITION_DESCS: Record<string, string> = {
    excellent: T.condition.excellentDesc,
    good: T.condition.goodDesc,
    fair: T.condition.fairDesc,
    poor: T.condition.poorDesc,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{T.common.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !car) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-4 text-foreground">{T.carDetail.notFound}</h1>
          <Link to="/catalog" className="text-primary hover:underline">{T.carDetail.backToCatalog}</Link>
        </div>
      </div>
    );
  }

  const favorite = isFavorite(car.id);
  const carImages = car.images.length > 0
    ? car.images.sort((a, b) => a.sort_order - b.sort_order).map(img => img.url)
    : ['https://images.unsplash.com/photo-1621007947622-7c9b888c6cc1?w=1200&q=80'];

  const prevSlide = () => setActiveSlide(p => p === 0 ? carImages.length - 1 : p - 1);
  const nextSlide = () => setActiveSlide(p => p === carImages.length - 1 ? 0 : p + 1);

  const handleShare = async () => {
    const url = window.location.href;
    const title = `${car.brand} ${car.model} ${car.year}`;
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* отменено */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success(T.carDetail.linkCopied);
      } catch {
        toast.error(T.carDetail.shareError);
      }
    }
  };

  const handleReserve = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      toast.error(T.carDetail.loginRequired);
      return;
    }
    if (car.viewing_enabled && windows.length > 0 && !selectedWindowId) {
      toast.error(T.carDetail.selectViewingTime ?? 'Выберите время для просмотра');
      return;
    }
    setReserving(true);
    try {
      // window_id передаётся сразу — бэкенд требует его в теле POST /reservations
      // когда у объявления включён viewing_enabled
      const res = await reservationsApi.reserve(car.id, selectedWindowId);

      if (res.payment_url) {
        setPaymentUrl(res.payment_url);
      } else {
        setReservationDone(true);
        toast.success(T.carDetail.reserveSuccess);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : T.common.error;
      if (msg.includes('already reserved')) {
        toast.error(T.carDetail.alreadyReserved);
      } else {
        toast.error(msg);
      }
    } finally {
      setReserving(false);
    }
  };

  const groupedWindows = groupWindowsByDate(windows);
  const sortedDates = Object.keys(groupedWindows).sort();

  const specs = [
    [T.carDetail.specs.brand, car.brand],
    [T.carDetail.specs.model, car.model],
    [T.carDetail.specs.year, String(car.year)],
    [T.carDetail.specs.mileage, formatMileage(car.mileage, lang)],
    ...(car.condition ? [[T.carDetail.specs.condition, CONDITION_LABELS[car.condition] ?? car.condition]] : []),
    ...(car.body_type ? [[T.carDetail.specs.body, BODY_LABELS[car.body_type] ?? car.body_type]] : []),
    ...((colorName ?? car.color) ? [[T.carDetail.specs.color, colorName ?? car.color!]] : []),
    ...(car.engine_volume ? [[T.carDetail.specs.engine, `${car.engine_volume} ${T.carDetail.liter}`]] : []),
    ...(car.engine_power ? [[T.carDetail.specs.power, `${car.engine_power} ${T.carCard.hp}`]] : []),
    ...(car.fuel_type ? [[T.carDetail.specs.fuel, FUEL_LABELS[car.fuel_type] ?? car.fuel_type]] : []),
    ...(car.transmission ? [[T.carDetail.specs.transmission, TRANSMISSION_LABELS[car.transmission] ?? car.transmission]] : []),
    ...(car.vin ? [[T.carDetail.specs.vin, car.vin]] : []),
  ];

  const isAvailable = car.status === 'available';

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>{T.carDetail.back}</span>
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Галерея */}
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="relative aspect-[16/9]">
                <ImageWithFallback src={carImages[activeSlide]}
                  alt={`${car.brand} ${car.model} — ${T.carDetail.photoOf} ${activeSlide + 1}`}
                  className={`w-full h-full object-cover ${car.status === 'sold' || car.status === 'inactive' ? 'brightness-75' : ''}`} />
                {(car.status === 'sold' || car.status === 'inactive') && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="px-6 py-3 bg-black/60 text-white text-xl font-bold rounded-xl tracking-wide backdrop-blur-sm border border-white/20">
                      {STATUS_LABELS[car.status]}
                    </span>
                  </div>
                )}
                {carImages.length > 1 && (
                  <>
                    <button onClick={prevSlide}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-card/90 hover:bg-card rounded-full flex items-center justify-center shadow transition-colors border border-border">
                      <ChevronLeft className="w-5 h-5 text-foreground" />
                    </button>
                    <button onClick={nextSlide}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-card/90 hover:bg-card rounded-full flex items-center justify-center shadow transition-colors border border-border">
                      <ChevronRight className="w-5 h-5 text-foreground" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                      {carImages.map((_, i) => (
                        <button key={i} onClick={() => setActiveSlide(i)}
                          className={`w-10 h-1 rounded-full transition-colors ${i === activeSlide ? 'bg-white' : 'bg-white/40'}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
              {carImages.length > 1 && (
                <div className="flex gap-2 p-3 overflow-x-auto bg-card">
                  {carImages.map((src, i) => (
                    <button key={i} onClick={() => setActiveSlide(i)}
                      className={`flex-shrink-0 w-20 h-14 rounded overflow-hidden border-2 transition-colors ${i === activeSlide ? 'border-primary' : 'border-border'}`}>
                      <ImageWithFallback src={src} alt={`${T.carDetail.thumbnailAlt} ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Заголовок */}
            <div className="bg-card rounded-lg border border-border p-4 sm:p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">{car.brand} {car.model}</h1>
                    {car.mileage === 0 && (
                      <span className="px-3 py-1 bg-accent text-accent-foreground rounded-full text-sm font-medium">{T.status.new}</span>
                    )}
                    {car.status && (
                      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[car.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                        {STATUS_LABELS[car.status] ?? car.status}
                      </span>
                    )}
                    {car.condition && (
                      <span className="relative group cursor-default">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${CONDITION_COLORS[car.condition] ?? 'bg-muted text-muted-foreground border-border'}`}>
                          {CONDITION_LABELS[car.condition] ?? car.condition}
                        </span>
                        {CONDITION_DESCS[car.condition] && (
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 pointer-events-none z-20 opacity-0 scale-95 -translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 transition-all duration-200 ease-out">
                            <span className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg shadow-xl border text-xs font-medium whitespace-nowrap backdrop-blur-sm ${CONDITION_COLORS[car.condition] ?? 'bg-popover text-popover-foreground border-border'}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 flex-shrink-0" />
                              {CONDITION_DESCS[car.condition]}
                              <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-current opacity-30" />
                            </span>
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {car.year} {T.carCard.year} • {formatMileage(car.mileage, lang)}
                    {cityName && <> • <MapPin className="w-3.5 h-3.5 inline-block mb-0.5 mr-0.5" />{cityName}</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleFavorite(car.id)}
                    className="p-2 rounded-lg border border-border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-destructive/25"
                    title={favorite ? T.carCard.removeFavorite : T.carCard.addFavorite}
                  >
                    <Heart className={`w-6 h-6 transition-colors ${favorite ? 'fill-destructive text-destructive' : 'text-muted-foreground'}`} />
                  </button>
                  <button
                    onClick={handleShare}
                    className="p-2 rounded-lg border border-border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/25"
                    title={T.carDetail.share}
                  >
                    <Share2 className="w-6 h-6 text-muted-foreground" />
                  </button>
                </div>
              </div>

              <div className="text-3xl sm:text-4xl font-semibold text-primary mb-4 sm:mb-6">{formatPrice(Number(car.price))}</div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {[
                  [T.carDetail.specs.year, String(car.year)],
                  [T.carDetail.specs.mileage, formatMileage(car.mileage, lang)],
                  [T.carDetail.specs.engine, car.engine_volume ? `${car.engine_volume}${T.carDetail.liter}` : '—'],
                  [T.carDetail.specs.power, car.engine_power ? `${car.engine_power} ${T.carCard.hp}` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="p-4 bg-secondary rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{label}</p>
                    <p className="font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Характеристики */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h2 className="text-2xl font-semibold text-foreground mb-4">{T.carDetail.specifications}</h2>
              <div className="space-y-3">
                {specs.map(([label, value], i) => (
                  <div key={label} className={`flex justify-between py-3 ${i < specs.length - 1 ? 'border-b border-border' : ''}`}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {car.description && (
              <div className="bg-card rounded-lg border border-border p-6">
                <h2 className="text-2xl font-semibold text-foreground mb-4">{T.carDetail.description}</h2>
                <p className="text-muted-foreground leading-relaxed">{car.description}</p>
              </div>
            )}
          </div>

          {/* Боковая панель — скрыта на мобиле, показывается с lg */}
          <div className="hidden lg:block space-y-6">
            <div className="bg-card rounded-lg border border-border p-6 sticky top-20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-foreground">{T.carDetail.actions}</h3>
                {car.status && (
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[car.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                    {STATUS_LABELS[car.status] ?? car.status}
                  </span>
                )}
              </div>

              {(car.status === 'sold' || car.status === 'inactive') ? (
                <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border text-center">
                  <p className="font-semibold text-foreground mb-1">
                    {car.status === 'sold' ? T.carDetail.soldStatus : T.carDetail.inactiveStatus}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {car.status === 'sold' ? T.carDetail.soldDesc : T.carDetail.inactiveDesc}
                  </p>
                </div>
              ) : reservationDone ? (
                <div className="mb-6 p-4 rounded-lg bg-accent/10 border border-accent/30 text-center">
                  <CheckCircle className="w-8 h-8 text-accent mx-auto mb-2" />
                  <p className="font-semibold text-foreground mb-1">{T.carDetail.bookingDone}</p>
                  <p className="text-sm text-muted-foreground mb-3">{T.carDetail.bookingDoneDesc2}</p>
                  <Link to="/profile?tab=reservations" className="text-sm text-primary hover:underline">
                    {T.carDetail.toProfile}
                  </Link>
                </div>
              ) : paymentUrl ? (
                <div className="mb-6 space-y-3">
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm font-medium text-foreground mb-1">{T.carDetail.paymentCreated}</p>
                    <p className="text-xs text-muted-foreground">{T.carDetail.depositInfo}</p>
                  </div>
                  <a
                    href={paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25"
                  >
                    <CreditCard className="w-5 h-5" />
                    {T.carDetail.payBtn}
                  </a>
                  <button
                    onClick={() => { setPaymentUrl(null); setShowBookingPanel(false); }}
                    className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {T.carDetail.payLater}
                  </button>
                </div>
              ) : (
                <div className="space-y-3 mb-6">
                  <button
                    onClick={() => { window.location.href = 'tel:+79001234567'; }}
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-accent text-accent-foreground rounded-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-accent/25"
                  >
                    <Phone className="w-5 h-5" />
                    <span>{T.carDetail.callBtn}</span>
                  </button>
                  <button
                    onClick={() => setShowBookingPanel(!showBookingPanel)}
                    className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg transition-all duration-200 ${
                      car.status === 'reserved'
                        ? 'bg-primary/60 text-primary-foreground cursor-default'
                        : 'bg-primary text-primary-foreground hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25'
                    }`}
                    disabled={car.status === 'reserved'}
                    title={car.status === 'reserved' ? T.carDetail.reservedTitle : undefined}
                  >
                    <Calendar className="w-5 h-5" />
                    <span>{car.status === 'reserved' ? T.status.reserved : T.carDetail.bookViewing}</span>
                  </button>
                </div>
              )}

              {/* Форма бронирования */}
              {showBookingPanel && !paymentUrl && !reservationDone && (
                <div className="pt-4 border-t border-border">
                  <h4 className="text-sm font-semibold text-foreground mb-3">{T.carDetail.viewingDesc}</h4>

                  {windowsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : windows.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-muted-foreground mb-3">{T.carDetail.noViewingTime}</p>
                    </div>
                  ) : (
                    <div className="space-y-3 mb-3 max-h-52 overflow-y-auto pr-1">
                      {sortedDates.map((date) => (
                        <div key={date}>
                          <p className="text-xs text-muted-foreground mb-1.5">{formatWindowDate(date, lang)}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {groupedWindows[date].map((w) => (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => setSelectedWindowId(selectedWindowId === w.id ? null : w.id)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                  selectedWindowId === w.id
                                    ? 'border-primary bg-primary/5 text-primary font-medium'
                                    : 'border-border hover:border-foreground/30 text-foreground'
                                }`}
                              >
                                {w.time_from.slice(0, 5)}–{w.time_to.slice(0, 5)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-3 mb-3 rounded-lg bg-secondary/60 border border-border text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-0.5">{T.carDetail.howBookingWorks}</p>
                    <p>{T.carDetail.bookingInfo}</p>
                  </div>

                  <button
                    onClick={handleReserve}
                    disabled={reserving}
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
                  >
                    {reserving
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> {T.carDetail.creating}</>
                      : <><CreditCard className="w-4 h-4" /> {T.carDetail.reserveBtn}{selectedWindowId ? '' : T.carDetail.withoutTime}</>
                    }
                  </button>
                </div>
              )}

              {/* Продавец */}
              <div className="mt-6 pt-6 border-t border-border">
                <h4 className="font-semibold text-foreground mb-3">{T.carDetail.seller}</h4>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-lg font-semibold select-none">
                    {car.seller_name
                      ? car.seller_name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                      : '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {car.seller_name ?? T.carDetail.privateSeller}
                    </p>
                    {car.seller_phone && (
                      <a href={`tel:${car.seller_phone}`} className="text-sm text-primary hover:underline">
                        {car.seller_phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Способы оплаты */}
              <div className="mt-6 pt-6 border-t border-border">
                <h4 className="font-semibold text-foreground mb-3">{T.carDetail.paymentMethods}</h4>
                {(car.accepts_cash || car.accepts_transfer) ? (
                  <div className="space-y-2">
                    {car.accepts_cash && (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary border border-border">
                        <Banknote className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{T.carDetail.cash}</p>
                          <p className="text-xs text-muted-foreground">{T.carDetail.cashDesc}</p>
                        </div>
                      </div>
                    )}
                    {car.accepts_transfer && (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary border border-border">
                        <ArrowRightLeft className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{T.carDetail.transfer}</p>
                          <p className="text-xs text-muted-foreground">{T.carDetail.transferDesc}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{T.carDetail.notSpecified}</p>
                )}
              </div>

              {/* Осмотр автомобиля */}
              <div className="mt-6 pt-6 border-t border-border">
                <h4 className="font-semibold text-foreground mb-3">{T.carDetail.viewingSection}</h4>

                {car.viewing_enabled === false ? (
                  <p className="text-sm text-muted-foreground">{T.carDetail.viewingDisabled}</p>
                ) : windowsLoading ? (
                  <div className="space-y-2">
                    <div className="h-3.5 bg-secondary rounded animate-pulse w-3/4" />
                    <div className="h-3.5 bg-secondary rounded animate-pulse w-1/2" />
                  </div>
                ) : windows.length > 0 ? (
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {sortedDates.slice(0, 4).map(date => (
                        <div key={date} className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground w-20 flex-shrink-0">{formatWindowDate(date, lang)}</span>
                          <span className="text-foreground font-medium">
                            {groupedWindows[date].map(w => `${w.time_from.slice(0, 5)}–${w.time_to.slice(0, 5)}`).join(', ')}
                          </span>
                        </div>
                      ))}
                      {sortedDates.length > 4 && (
                        <p className="text-xs text-muted-foreground">
                          {T.carDetail.moreSlots} {sortedDates.length - 4}…
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{T.carDetail.noSchedule}</p>
                )}

                {/* Город + адрес осмотра */}
                <div className="flex items-start gap-2 mt-3">
                  <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    {cityName && <p className="font-medium text-foreground">{cityName}</p>}
                    {car.sale_address ? (
                      <p className="text-muted-foreground">{car.sale_address}</p>
                    ) : (
                      <p className="text-muted-foreground">{T.carDetail.addressAfterBooking}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom bar — только мобиль */}
      {isAvailable && !reservationDone && !paymentUrl && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border px-4 py-3 flex gap-3">
          <a
            href="tel:+79001234567"
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-accent text-accent-foreground rounded-lg font-medium text-sm"
          >
            <Phone className="w-4 h-4" />
            <span>{T.carDetail.callBtn}</span>
          </a>
          <button
            onClick={() => setShowBookingPanel(true)}
            disabled={car.status === 'reserved'}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm disabled:opacity-60"
          >
            <Calendar className="w-4 h-4" />
            <span>{car.status === 'reserved' ? T.status.reserved : T.carDetail.bookViewing}</span>
          </button>
        </div>
      )}

      {/* Мобильная панель бронирования */}
      {showBookingPanel && !paymentUrl && !reservationDone && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowBookingPanel(false)} />
          <div className="relative bg-card rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground text-lg">{T.carDetail.viewingDesc}</h3>
              <button onClick={() => setShowBookingPanel(false)} className="p-1.5 text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            {windowsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : windows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{T.carDetail.noViewingTime}</p>
            ) : (
              <div className="space-y-3 mb-4">
                {sortedDates.map((date) => (
                  <div key={date}>
                    <p className="text-xs text-muted-foreground mb-1.5">{formatWindowDate(date, lang)}</p>
                    <div className="flex flex-wrap gap-2">
                      {groupedWindows[date].map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setSelectedWindowId(selectedWindowId === w.id ? null : w.id)}
                          className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                            selectedWindowId === w.id
                              ? 'border-primary bg-primary/5 text-primary font-medium'
                              : 'border-border hover:border-foreground/30 text-foreground'
                          }`}
                        >
                          {w.time_from.slice(0, 5)}–{w.time_to.slice(0, 5)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 mb-4 rounded-lg bg-secondary/60 border border-border text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-0.5">{T.carDetail.howBookingWorks}</p>
              <p>{T.carDetail.bookingInfo}</p>
            </div>

            <button
              onClick={handleReserve}
              disabled={reserving}
              className="flex items-center justify-center gap-2 w-full px-4 py-3.5 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50"
            >
              {reserving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {T.carDetail.creating}</>
                : <><CreditCard className="w-4 h-4" /> {T.carDetail.reserveBtn}{selectedWindowId ? '' : T.carDetail.withoutTime}</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
