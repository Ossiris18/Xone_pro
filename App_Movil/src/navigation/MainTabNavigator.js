import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../views/home/HomeScreen';
import ReservasScreen from '../views/reservas/ReservasScreen';
import PerfilScreen from '../views/perfil/PerfilScreen';
import { colors } from '../constants/theme';

const Tab = createBottomTabNavigator();

const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarIcon: ({ focused, color }) => {
          let iconName;
          let label;

          if (route.name === 'Explorar') {
            iconName = focused ? 'search' : 'search-outline';
            label = 'Explorar';
          } else if (route.name === 'Mis Viajes') {
            iconName = focused ? 'briefcase' : 'briefcase-outline';
            label = 'Mis Viajes';
          } else if (route.name === 'Perfil') {
            iconName = focused ? 'person' : 'person-outline';
            label = 'Perfil';
          }

          return (
            <View style={styles.iconContainer}>
              <Ionicons name={iconName} size={22} color={color} />
              <Text style={[styles.tabLabel, { color: focused ? colors.primary : colors.textSecondary, fontWeight: focused ? '700' : '500' }]}>
                {label}
              </Text>
            </View>
          );
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      })}
    >
      <Tab.Screen name="Explorar" component={HomeScreen} />
      <Tab.Screen name="Mis Viajes" component={ReservasScreen} />
      <Tab.Screen name="Perfil" component={PerfilScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    elevation: 8,
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 70,
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    borderTopWidth: 0,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    top: 14,
    width: 80,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 3,
  },
});

export default MainTabNavigator;
