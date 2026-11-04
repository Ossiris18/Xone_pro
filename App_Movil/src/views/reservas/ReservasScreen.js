import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl, SafeAreaView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { doc, updateDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { getUsuarioPorUid, getReservasByUsuario, getSucursalById, sincronizarRelojHabitaciones } from '../../services/apiServices';
import { authServices } from '../../services/authServices';
import { colors } from '../../constants/theme';

const mostrarFechaSegura = (fechaFirebase) => {
  if (!fechaFirebase) return "Por definir";
  if (typeof fechaFirebase.toDate === 'function') {
    return fechaFirebase.toDate().toLocaleDateString("es-MX");
  }
  return String(fechaFirebase);
};

const ReservasScreen = ({ navigation }) => {
  const [reservas, setReservas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);
  const [error, setError] = useState(null);

  const fetchReservas = useCallback(async () => {
    if (!auth.currentUser) {
      setError("Inicia sesión para consultar tus viajes.");
      setLoading(false);
      return;
    }

    try {
      setError(null);
      await sincronizarRelojHabitaciones();
      // Sincronizar cualquier reserva registrada en Recepción con la CURP o correo del usuario
      await authServices.sincronizarCuentaYReservas({ user: auth.currentUser });

      const uid = auth.currentUser.uid;
      const correo = auth.currentUser.email || "";
      const userProfile = await getUsuarioPorUid(uid);
      const curpUsuario = userProfile?.curp || "";

      const userReservas = await getReservasByUsuario(curpUsuario, uid, correo);

      const reservasConSucursal = await Promise.all(
        userReservas.map(async (reserva) => {
          if (reserva.idSucursal) {
            try {
              const sucursal = await getSucursalById(reserva.idSucursal);
              if (sucursal) {
                return {
                  ...reserva,
                  nombreHotel: sucursal.nombre || "Hotel Xone",
                  estadoHotel: sucursal.ubicacion?.estado || "",
                  municipioHotel: sucursal.ubicacion?.municipio || "",
                };
              }
            } catch (e) {
              // Ignorar fallo individual de sucursal
            }
          }
          return {
            ...reserva,
            nombreHotel: "Hotel Xone",
            estadoHotel: "",
            municipioHotel: "",
          };
        })
      );

      setReservas(reservasConSucursal);
    } catch (err) {
      console.error("Error al cargar las reservas:", err);
      setError("Ocurrió un error al sincronizar tus viajes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchReservas();
    }, [fetchReservas])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchReservas().finally(() => setRefreshing(false));
  }, [fetchReservas]);

  const confirmarCancelacion = (reserva) => {
    Alert.alert(
      "Cancelar Reservación",
      `¿Deseas cancelar tu estancia en ${reserva.nombreHotel} (Habitación #${reserva.numeroHabitacion})?\n\nLa habitación quedará liberada inmediatamente.`,
      [
        { text: "Conservar reserva", style: "cancel" },
        {
          text: "Sí, cancelar",
          style: "destructive",
          onPress: () => ejecutarCancelacion(reserva),
        },
      ]
    );
  };

  const ejecutarCancelacion = async (reserva) => {
    setCancelingId(reserva.id);
    try {
      // 1. Marcar la reservación como Cancelada
      await updateDoc(doc(db, "Reservas", reserva.id), {
        estado: "Cancelada",
        fechaCancelacion: serverTimestamp(),
      });

      // 2. Liberar la habitación asignada en Habitaciones
      if (reserva.idHabitacion) {
        const habRef = doc(db, "Habitaciones", reserva.idHabitacion);
        const habSnap = await getDoc(habRef);
        if (habSnap.exists()) {
          await updateDoc(habRef, {
            estado: "disponible",
            huespedNombre: null,
            huespedID: null,
            fechaEntrada: null,
            fechaSalida: null,
            totalActual: null,
            fechaIngreso: null,
          });
        }
      }

      // 3. Ajustar totalEstancias del usuario si aplica
      if (auth.currentUser?.uid) {
        const userRef = doc(db, "Usuarios", auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const actual = Number(userSnap.data().totalEstancias || 0);
          if (actual > 0) {
            await updateDoc(userRef, {
              totalEstancias: Math.max(0, actual - 1),
            });
          }
        }
      }

      // 4. Registrar en Bitácora con los campos estándar del Admin
      const nombreLog = reserva.nombreUsuario || reserva.huespedNombre || auth.currentUser?.displayName || "Huésped";
      await addDoc(collection(db, "Bitacora"), {
        tipoAccion: "ELIMINACIÓN",
        nombreEmpleado: `${nombreLog} (App Móvil)`,
        rolEmpleado: "Huésped",
        detalles: `Cancelación desde App: Hab. #${reserva.numeroHabitacion} (${reserva.nombreHotel}) del ${reserva.fechaEntrada || "-"} al ${reserva.fechaSalida || "-"}`,
        fecha: serverTimestamp(),
      });

      await fetchReservas();
      Alert.alert("Reserva Cancelada", "Tu reservación ha sido cancelada y la habitación fue liberada.");
    } catch (e) {
      console.error("Error al cancelar reserva:", e);
      Alert.alert("Error", "No se pudo cancelar la reservación. Intenta nuevamente.");
    } finally {
      setCancelingId(null);
    }
  };

  const renderItem = ({ item }) => {
    const ubicacionStr = [item.municipioHotel, item.estadoHotel].filter(Boolean).join(", ");
    const esActiva = item.estado === "Activa";
    const esCancelada = item.estado === "Cancelada";

    return (
      <View style={[styles.card, esCancelada && { opacity: 0.78 }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.hotelName} numberOfLines={1}>{item.nombreHotel}</Text>
            {ubicacionStr ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.locationText}>{ubicacionStr}</Text>
              </View>
            ) : null}
          </View>
          <View
            style={[
              styles.estadoBadge,
              esActiva
                ? styles.estadoActiva
                : esCancelada
                ? styles.estadoCancelada
                : styles.estadoCompletada,
            ]}
          >
            <Text
              style={[
                styles.estadoText,
                {
                  color: esActiva
                    ? colors.primaryDark
                    : esCancelada
                    ? colors.error
                    : colors.success,
                },
              ]}
            >
              {esActiva ? "Confirmada" : esCancelada ? "Cancelada" : "Completada"}
            </Text>
          </View>
        </View>

        <View style={styles.separator} />

        <View style={styles.datesBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateBoxLabel}>CHECK-IN ({item.horaCheckIn || "15:00 hrs"})</Text>
            <Text style={styles.dateBoxValue}>{mostrarFechaSegura(item.fechaEntrada)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.dateBoxLabel}>CHECK-OUT ({item.horaCheckOut || "12:00 hrs"})</Text>
            <Text style={styles.dateBoxValue}>{mostrarFechaSegura(item.fechaSalida)}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Categoría / Habitación</Text>
          <Text style={styles.detailValue}>
            {item.tipoHabitacion || "Tradicional"} • Hab. #{item.numeroHabitacion || "-"}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Titular de reserva</Text>
          <Text style={styles.detailValue}>{item.nombreUsuario || item.huespedNombre || "-"}</Text>
        </View>
        {item.idUsuario ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>CURP vinculada</Text>
            <Text style={styles.detailValue}>{item.idUsuario}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Canal / Método de pago</Text>
          <Text style={styles.detailValue}>
            {item.metodoPago || "Tarjeta"}{item.ultimos4Tarjeta ? ` •••• ${item.ultimos4Tarjeta}` : ""}
          </Text>
        </View>

        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total Pagado (IVA incl.)</Text>
          <Text style={[styles.totalValue, esCancelada && { textDecorationLine: 'line-through', color: colors.textSecondary }]}>
            ${Number(item.totalGenerado || 0).toFixed(2)} MXN
          </Text>
        </View>

        {esActiva && (
          <Pressable
            style={[styles.cancelBtn, cancelingId === item.id && { opacity: 0.6 }]}
            onPress={() => confirmarCancelacion(item)}
            disabled={cancelingId === item.id}
          >
            {cancelingId === item.id ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={17} color={colors.error} />
                <Text style={styles.cancelBtnText}>Cancelar Reservación</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBlock}>
        <Text style={styles.headerTag}>ITINERARIO</Text>
        <Text style={styles.title}>Mis Viajes</Text>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : reservas.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="briefcase-outline" size={38} color={colors.primary} />
          </View>
          <Text style={styles.emptyText}>Aún no tienes reservaciones</Text>
          <Text style={styles.emptySubText}>
            Tus reservas de la App y las registradas en Recepción con tu CURP o correo aparecerán aquí automáticamente.
          </Text>
          <Pressable
            style={styles.exploreBtn}
            onPress={() => navigation.navigate("Explorar")}
          >
            <Text style={styles.exploreBtnText}>Explorar Hoteles</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={reservas}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 42,
    paddingBottom: 14,
  },
  headerTag: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 130,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hotelName: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  locationText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  estadoBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  estadoCompletada: {
    backgroundColor: colors.successSoft,
  },
  estadoActiva: {
    backgroundColor: '#e0f2fe',
  },
  estadoCancelada: {
    backgroundColor: '#fee2e2',
  },
  estadoText: {
    fontSize: 11,
    fontWeight: '800',
  },
  separator: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginVertical: 14,
  },
  datesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateBoxLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  dateBoxValue: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginTop: 3,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  totalContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginTop: 10,
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cancelBtnText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '800',
  },
  errorText: {
    fontSize: 15,
    color: colors.error,
    textAlign: 'center',
    fontWeight: '600',
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  exploreBtn: {
    marginTop: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  exploreBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});

export default ReservasScreen;
