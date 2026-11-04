import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  TextInput,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/theme";
import { getSucursales } from "../../services/apiServices";
import { useFocusEffect } from "@react-navigation/native";
import { useLocation } from "../../hooks/useLocation";
import { useInactivity } from "../../hooks/useInactivity";

const getImageSource = (fotoUrl) => {
  if (!fotoUrl) return null;
  return { uri: fotoUrl };
};

const calcularDistancia = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function HomeScreen({ navigation }) {
  const [sucursales, setSucursales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filtrarCercanos, setFiltrarCercanos] = useState(false);

  const panResponder = useInactivity(navigation);
  const { ubicacion, permisoOtorgado, cargando: cargandoUbicacion, reintentarUbicacion } = useLocation();

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const loadSucursales = async () => {
        try {
          setLoading(true);
          const data = await getSucursales();
          if (mounted) {
            setSucursales(data);
            setError("");
          }
        } catch (err) {
          if (mounted) setError("No fue posible cargar los hoteles.");
        } finally {
          if (mounted) setLoading(false);
        }
      };
      loadSucursales();
      return () => {
        mounted = false;
      };
    }, [])
  );

  const onPressCercanos = () => {
    if (!permisoOtorgado || !ubicacion) {
      reintentarUbicacion();
      return;
    }
    setFiltrarCercanos((prev) => !prev);
  };

  const groupedHotels = useMemo(() => {
    const term = search.trim().toLowerCase();
    let filtered = sucursales.filter((hotel) => {
      if (!term) return true;
      const nombre = (hotel?.nombre || "").toLowerCase();
      const municipio = (hotel?.ubicacion?.municipio || "").toLowerCase();
      const estado = (hotel?.ubicacion?.estado || "").toLowerCase();
      return nombre.includes(term) || municipio.includes(term) || estado.includes(term);
    });

    if (filtrarCercanos && ubicacion) {
      filtered = filtered
        .filter((h) => h?.ubicacion?.lat && h?.ubicacion?.lng)
        .map((h) => ({
          ...h,
          distancia: calcularDistancia(
            ubicacion.lat,
            ubicacion.lng,
            Number(h.ubicacion.lat),
            Number(h.ubicacion.lng)
          ),
        }))
        .sort((a, b) => a.distancia - b.distancia);

      return [{ municipio: "Cerca de tu ubicación", hoteles: filtered }];
    }

    const map = filtered.reduce((acc, hotel) => {
      const municipio = hotel?.ubicacion?.municipio || "Destinos destacados";
      if (!acc[municipio]) acc[municipio] = [];
      acc[municipio].push(hotel);
      return acc;
    }, {});

    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((municipio) => ({ municipio, hoteles: map[municipio] }));
  }, [search, sucursales, filtrarCercanos, ubicacion]);

  const renderHotelCard = (item, isVertical = false) => {
    const ubicacionTexto = [item?.ubicacion?.municipio, item?.ubicacion?.estado]
      .filter(Boolean)
      .join(", ");

    return (
      <Pressable
        key={item.id}
        style={isVertical ? styles.hotelCardVertical : styles.hotelCard}
        onPress={() => navigation.navigate("HotelDetail", { idSucursal: item.id })}
      >
        <View style={{ position: "relative" }}>
          {item.fotoUrl ? (
            <Image
              source={getImageSource(item.fotoUrl)}
              style={isVertical ? styles.hotelImageVertical : styles.hotelImage}
            />
          ) : (
            <View style={[isVertical ? styles.hotelImageVertical : styles.hotelImage, styles.placeholder]}>
              <Ionicons name="business-outline" size={32} color={colors.textSecondary} />
            </View>
          )}
          {item.disponiblesCount !== undefined && (
            <View style={styles.availabilityBadge}>
              <View style={[styles.dotIndicator, { backgroundColor: item.disponiblesCount > 0 ? "#22c55e" : "#ef4444" }]} />
              <Text style={styles.availabilityBadgeText}>
                {item.disponiblesCount > 0 ? `${item.disponiblesCount} disp.` : "Agotado"}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.hotelBody}>
          <Text style={styles.hotelName} numberOfLines={1}>{item.nombre}</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.hotelLocation} numberOfLines={1}>
              {ubicacionTexto || "Ubicación disponible"}
            </Text>
          </View>

          <View style={styles.cardFooterRow}>
            {item.precioMinimo ? (
              <Text style={styles.priceFromText}>
                Desde <Text style={styles.priceAmount}>${item.precioMinimo.toLocaleString()} MXN</Text> / noche
              </Text>
            ) : (
              <Text style={styles.priceFromText}>Ver disponibilidad</Text>
            )}

            {item.distancia !== undefined && (
              <View style={styles.distancePill}>
                <Ionicons name="navigate" size={11} color={colors.primary} />
                <Text style={styles.distanciaText}>
                  {item.distancia < 1
                    ? `${Math.round(item.distancia * 1000)} m`
                    : `${item.distancia.toFixed(1)} km`}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderMunicipioSection = ({ item }) => {
    const esCercanos = item.municipio === "Cerca de tu ubicación";

    return (
      <View style={styles.sectionWrap}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{item.municipio}</Text>
          <Text style={styles.sectionCount}>{item.hoteles.length} {item.hoteles.length === 1 ? "propiedad" : "propiedades"}</Text>
        </View>
        {esCercanos ? (
          <View style={styles.verticalList}>
            {item.hoteles.map((hotel) => renderHotelCard(hotel, true))}
          </View>
        ) : (
          <FlatList
            data={item.hoteles}
            horizontal
            keyExtractor={(hotel) => hotel.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            renderItem={({ item: hotel }) => renderHotelCard(hotel, false)}
          />
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Sincronizando catálogo de hoteles...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} {...panResponder.panHandlers}>
      <FlatList
        data={groupedHotels}
        keyExtractor={(item) => item.municipio}
        renderItem={renderMunicipioSection}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.stickyHeader}>
            <Text style={styles.brandGreeting}>Xone Stays</Text>
            <Text style={styles.brandHeadline}>Encuentra tu próximo destino</Text>
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar hotel, ciudad o estado..."
                  placeholderTextColor={colors.textSecondary}
                  value={search}
                  onChangeText={setSearch}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch("")}>
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.locationButton, filtrarCercanos && styles.locationButtonActive]}
                onPress={onPressCercanos}
                disabled={cargandoUbicacion}
              >
                {cargandoUbicacion ? (
                  <ActivityIndicator size="small" color={filtrarCercanos ? "#fff" : colors.primary} />
                ) : (
                  <Ionicons
                    name={filtrarCercanos ? "navigate" : "navigate-outline"}
                    size={20}
                    color={filtrarCercanos ? "#ffffff" : colors.primary}
                  />
                )}
              </TouchableOpacity>
            </View>
            {filtrarCercanos && ubicacion && (
              <View style={styles.cercanosBannerWrap}>
                <Ionicons name="locate" size={14} color={colors.primary} />
                <Text style={styles.cercanosBanner}>Ordenados por cercanía GPS en tiempo real</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={40} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Sin resultados para tu búsqueda</Text>
            <Text style={styles.emptySubtitle}>
              Intenta buscar otro destino o desactiva el filtro de ubicación.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stickyHeader: {
    paddingHorizontal: 20,
    paddingTop: 42,
    paddingBottom: 14,
    backgroundColor: colors.background,
  },
  brandGreeting: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  brandHeadline: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    marginTop: 2,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  locationButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  locationButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cercanosBannerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  cercanosBanner: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 130,
  },
  sectionWrap: {
    marginTop: 14,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
  },
  sectionCount: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  carouselContent: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 14,
  },
  verticalList: {
    paddingHorizontal: 20,
    gap: 14,
  },
  hotelCard: {
    width: 270,
    backgroundColor: colors.surface,
    borderRadius: 20,
    shadowColor: colors.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  hotelCardVertical: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    marginBottom: 4,
  },
  hotelImage: {
    width: 270,
    height: 170,
    backgroundColor: "#e2e8f0",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  hotelImageVertical: {
    width: "100%",
    height: 185,
    backgroundColor: "#e2e8f0",
  },
  availabilityBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dotIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  availabilityBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  placeholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  hotelBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  hotelName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  hotelLocation: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  cardFooterRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceFromText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  priceAmount: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  distancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  distanciaText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "700",
  },
  centeredScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: "700",
  },
  emptyState: {
    paddingVertical: 50,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
  },
});
