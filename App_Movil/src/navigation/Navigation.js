import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import Welcome from "../views/auth/Welcome";
import LoginScreen from "../views/auth/LoginScreen";
import RegisterScreen from "../views/auth/RegisterScreen";
import MainTabNavigator from "./MainTabNavigator";
import { auth, db } from "../config/firebase";
import { colors } from "../constants/theme";

import HotelDetailScreen from "../views/catalogo/HotelDetailScreen";
import CheckoutScreen from "../views/catalogo/CheckoutScreen";

const Stack = createNativeStackNavigator();
const SUPER_ADMIN_EMAIL = "ossither1830@gmail.com";

export default function Navigation() {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let unsubUserDoc = null;

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      const cleanEmail = String(user?.email || "").trim().toLowerCase();
      const isVerified = Boolean(user && (user.emailVerified || cleanEmail === SUPER_ADMIN_EMAIL));
      setIsAuthenticated(isVerified);
      setLoading(false);

      // Si el usuario está con sesión iniciada y el Admin elimina su cuenta en tiempo real,
      // cerramos su sesión automáticamente de inmediato.
      if (isVerified && user?.uid) {
        let existiaPreviamente = false;
        unsubUserDoc = onSnapshot(
          doc(db, "Usuarios", user.uid),
          (snap) => {
            if (snap.exists()) {
              existiaPreviamente = true;
            } else if (existiaPreviamente) {
              signOut(auth).catch(() => {});
              Alert.alert("Sesión finalizada", "Tu cuenta ha sido eliminada del sistema.");
            }
          },
          () => {}
        );
      }
    });

    return () => {
      if (unsubUserDoc) unsubUserDoc();
      unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen name="HotelDetail" component={HotelDetailScreen} />
            <Stack.Screen name="Checkout" component={CheckoutScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Welcome" component={Welcome} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
});