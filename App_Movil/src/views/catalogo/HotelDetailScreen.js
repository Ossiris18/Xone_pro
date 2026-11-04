import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { colors } from "../../constants/theme";
import { getSucursalById, sincronizarRelojHabitaciones } from "../../services/apiServices";

const getImageSource = (fotoUrl) => {
  if (!fotoUrl) return null;
  return { uri: fotoUrl };
};

export default function HotelDetailScreen({ navigation, route }) {
  const { idSucursal } = route.params || {};
  const [hotel, setHotel] = useState(null);
  const [todasHabitaciones, setTodasHabitaciones] = useState([]);
  const [selectedTipo, setSelectedTipo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    if (!idSucursal) {
      setError("No se encontró el hotel.");
      setLoading(false);
      return;
    }

    const loadHotel = async () => {
      try {
        await sincronizarRelojHabitaciones();
        const hotelData = await getSucursalById(idSucursal);
        if (mounted) setHotel(hotelData);
      } catch (err) {
        if (mounted) setError("No fue posible cargar el detalle del hotel.");
      }
    };

    loadHotel();

    // Escuchar TODAS las habitaciones del hotel para agruparlas por Categoría (Room Pooling)
    const q = query(
      collection(db, "Habitaciones"),
      where("idSucursal", "==", idSucursal)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!mounted) return;
        const roomsData = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }));
        setTodasHabitaciones(roomsData);
        setLoading(false);
      },
      () => {
        if (mounted) {
          setError("Error al sincronizar disponibilidad.");
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [idSucursal]);

  // Agrupación por Tipo de Habitación (evita repetir tarjetas idénticas y permite reservar para cualquier fecha libre)
  const categoriasAgrupadas = useMemo(() => {
    const mapa = {};
    todasHabitaciones.forEach((hab) => {
      const clave = hab.tipo || "Tradicional";
      if (!mapa[clave]) {
        mapa[clave] = {
          tipo: clave,
          precioBase: Number(hab.precioBase || 0),
          fotoUrl: hab.fotoUrl || null,
          servicios: Array.isArray(hab.servicios) ? hab.servicios : [],
          totalUnidades: 0,
          disponiblesHoy: [],
          todasUnidades: [],
        };
      }
      mapa[clave].totalUnidades += 1;
      mapa[clave].todasUnidades.push(hab);
      if (hab.estado === "disponible") {
        mapa[clave].disponiblesHoy.push(hab);
      }
    });

    return Object.values(mapa);
  }, [todasHabitaciones]);

  // Seleccionar automáticamente la primera categoría del hotel
  useEffect(() => {
    if (categoriasAgrupadas.length === 0) {
      setSelectedTipo(null);
      return;
    }
    const existeSeleccionada = categoriasAgrupadas.find((c) => c.tipo === selectedTipo);
    if (!existeSeleccionada) {
      const primeraConCupoHoy = categoriasAgrupadas.find((c) => c.disponiblesHoy.length > 0);
      setSelectedTipo(primeraConCupoHoy ? primeraConCupoHoy.tipo : categoriasAgrupadas[0].tipo);
    }
  }, [categoriasAgrupadas, selectedTipo]);

  const categoriaSeleccionadaObj = useMemo(
    () => categoriasAgrupadas.find((c) => c.tipo === selectedTipo) || null,
    [categoriasAgrupadas, selectedTipo]
  );

  const hotelUbicacion = useMemo(() => {
    return [
      hotel?.ubicacion?.direccion,
      hotel?.ubicacion?.municipio,
      hotel?.ubicacion?.estado,
    ]
      .filter(Boolean)
      .join(", ");
  }, [hotel]);

  const renderCategoria = ({ item }) => {
    const servicios = Array.isArray(item.servicios) ? item.servicios : [];
    const selected = selectedTipo === item.tipo;
    const cupoHoy = item.disponiblesHoy.length;

    return (
      <Pressable
        style={[styles.roomCard, selected && styles.roomCardSelected]}
        onPress={() => setSelectedTipo(item.tipo)}
      >
        <View style={{ position: "relative" }}>
          {item.fotoUrl ? (
            <Image source={getImageSource(item.fotoUrl)} style={styles.roomImage} />
          ) : (
            <View style={[styles.roomImage, styles.roomImagePlaceholder]}>
              <Ionicons name="bed-outline" size={32} color={colors.textSecondary} />
            </View>
          )}
          <View style={[styles.poolBadge, styles.poolBadgeOk]}>
            <Text style={styles.poolBadgeText}>
              {cupoHoy > 0
                ? `${cupoHoy} de ${item.totalUnidades} libre${cupoHoy === 1 ? "" : "s"} hoy`
                : `Disponible para otras fechas (${item.totalUnidades} hab.)`}
            </Text>
          </View>
        </View>

        <View style={styles.roomBody}>
          <View style={styles.roomHeaderRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.roomTitle}>Habitación {item.tipo}</Text>
              <Text style={styles.roomSubtitle}>
                Check-in 15:00 hrs · Check-out 12:00 hrs · Apartado por calendario
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.roomPrice}>${Number(item.precioBase || 0).toLocaleString()} MXN</Text>
              <Text style={styles.roomPerNight}>por noche</Text>
            </View>
          </View>

          {servicios.length > 0 && (
            <View style={styles.chipsWrap}>
              {servicios.slice(0, 6).map((servicio, index) => (
                <View style={styles.chip} key={`${servicio}-${index}`}>
                  <Text style={styles.chipText}>{servicio}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !hotel) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <Text style={styles.errorText}>{error || "Hotel no encontrado."}</Text>
      </SafeAreaView>
    );
  }

  // Siempre permitimos pasar al calendario (Checkout) aunque hoy esté ocupada, para poder apartar en otros días/meses
  const habitacionParaReservar =
    categoriaSeleccionadaObj?.disponiblesHoy?.[0] ||
    categoriaSeleccionadaObj?.todasUnidades?.[0] ||
    null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={categoriasAgrupadas}
        keyExtractor={(item) => item.tipo}
        renderItem={renderCategoria}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={{ position: "relative" }}>
              {hotel.fotoUrl ? (
                <Image source={getImageSource(hotel.fotoUrl)} style={styles.heroImage} />
              ) : (
                <View style={[styles.heroImage, styles.roomImagePlaceholder]}>
                  <Ionicons name="business-outline" size={44} color={colors.textSecondary} />
                </View>
              )}
              <TouchableOpacity style={styles.floatingBackBtn} onPress={() => navigation.goBack()}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.headerBlock}>
              <Text style={styles.hotelName}>{hotel.nombre}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                <Ionicons name="location-outline" size={16} color={colors.primary} />
                <Text style={styles.hotelLocation}>{hotelUbicacion || "Ubicación disponible"}</Text>
              </View>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionLabel}>Categorías de Habitación</Text>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{todasHabitaciones.length} habs. en hotel</Text>
                </View>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="bed-outline" size={38} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Sin habitaciones registradas</Text>
            <Text style={styles.emptySubtitle}>Este hotel aún no tiene inventario cargado.</Text>
          </View>
        }
      />

      <View style={styles.bottomBar}>
        <View>
          <Text style={styles.bottomPriceLabel}>
            {categoriaSeleccionadaObj
              ? `Categoría ${categoriaSeleccionadaObj.tipo} (${categoriaSeleccionadaObj.totalUnidades} hab.)`
              : "Selecciona categoría"}
          </Text>
          <Text style={styles.bottomPrice}>
            ${Number(categoriaSeleccionadaObj?.precioBase || 0).toLocaleString()} MXN{" "}
            <Text style={styles.bottomNight}>/ noche</Text>
          </Text>
        </View>

        <Pressable
          style={[styles.reserveButton, !habitacionParaReservar && styles.reserveButtonDisabled]}
          disabled={!habitacionParaReservar}
          onPress={() =>
            navigation.navigate("Checkout", {
              hotel,
              habitacion: habitacionParaReservar,
              tipoCategoria: categoriaSeleccionadaObj.tipo,
            })
          }
        >
          <Text style={styles.reserveButtonText}>
            {habitacionParaReservar ? "Elegir fechas y reservar" : "Sin inventario"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: 120,
  },
  heroImage: {
    width: "100%",
    height: 270,
    backgroundColor: colors.muted,
  },
  floatingBackBtn: {
    position: "absolute",
    top: 44,
    left: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  hotelName: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
  },
  hotelLocation: {
    color: colors.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  sectionTitleRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.success,
  },
  roomCard: {
    marginTop: 14,
    marginHorizontal: 20,
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: colors.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  roomCardSelected: {
    borderColor: colors.primary,
  },
  roomImage: {
    width: "100%",
    height: 180,
    backgroundColor: colors.muted,
  },
  roomImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  poolBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  poolBadgeOk: {
    backgroundColor: "rgba(22, 163, 74, 0.92)",
  },
  poolBadgeEmpty: {
    backgroundColor: "rgba(220, 38, 38, 0.92)",
  },
  poolBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  roomBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  roomHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  roomTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  roomSubtitle: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  roomPrice: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: "800",
  },
  roomPerNight: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  chip: {
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  chipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
    elevation: 16,
  },
  bottomPriceLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  bottomPrice: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  bottomNight: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  reserveButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  reserveButtonDisabled: {
    opacity: 0.5,
  },
  reserveButtonText: {
    color: colors.textLight,
    fontSize: 14,
    fontWeight: "800",
  },
  centeredScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: colors.error,
    fontWeight: "700",
  },
  emptyState: {
    marginTop: 32,
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 6,
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
