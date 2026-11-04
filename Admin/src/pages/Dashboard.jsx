import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { db } from '../firebase';
import { Users, CalendarCheck, Clock, TrendingUp } from 'lucide-react';

function Dashboard() {
  const [reservas, setReservas] = useState([]);
  const [mapaSucursales, setMapaSucursales] = useState({});
  const [stats, setStats] = useState({ ingresos: 0, activas: 0, total: 0 });
  const sesion = JSON.parse(localStorage.getItem('sesionSkyStay'));

  useEffect(() => {
    if (!sesion) return;
    const cargarNombresHoteles = async () => {
      const snap = await getDocs(collection(db, "Sucursales"));
      const mapa = {};
      snap.forEach(doc => { mapa[doc.id] = doc.data().nombre; });
      setMapaSucursales(mapa);
    };
    cargarNombresHoteles();

    let q = sesion.rol === 'Admin VIP'
      ? query(collection(db, "Reservas"))
      : query(collection(db, "Reservas"), where("idSucursal", "==", sesion.idSucursal));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a, b) => (b.fechaIngreso?.toMillis?.() || 0) - (a.fechaIngreso?.toMillis?.() || 0));

      let sumaIngresos = 0;
      let habitacionesOcupadas = 0;
      docs.forEach(res => {
        if (res.estado === 'Activa') habitacionesOcupadas++;
        if (res.estado === 'Completada' || res.estado === 'Activa') {
          sumaIngresos += Number(res.totalGenerado || 0);
        }
      });
      setReservas(docs);
      setStats({ ingresos: sumaIngresos, activas: habitacionesOcupadas, total: docs.length });
    });
    return () => unsubscribe();
  }, [sesion?.idSucursal, sesion?.rol]);

  const badgeEstado = (estado) => {
    if (estado === 'Activa') return { bg: '#fee2e2', color: '#dc2626', text: 'EN ESTANCIA' };
    if (estado === 'Cancelada') return { bg: '#f1f5f9', color: '#64748b', text: 'CANCELADA' };
    return { bg: '#dcfce7', color: '#16a34a', text: 'COMPLETADA' };
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header" style={{ marginBottom: '25px' }}>
        <h2 style={{ fontSize: '24px', color: '#0f172a', fontWeight: '800' }}>Dashboard Global de Operaciones</h2>
        <p style={{ color: '#64748b' }}>Monitoreo distribuido en tiempo real — {sesion?.nombre}</p>
      </div>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
        {sesion?.rol === 'Admin VIP' && (
          <div className="stat-card" style={{ flex: 1, minWidth: '240px', background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ background: '#dcfce7', color: '#16a34a', padding: '14px', borderRadius: '12px' }}><TrendingUp /></div>
            <div>
              <h3 style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '600' }}>Ingresos Acumulados</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>${stats.ingresos.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</p>
            </div>
          </div>
        )}

        <div className="stat-card" style={{ flex: 1, minWidth: '240px', background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ background: '#fee2e2', color: '#ef4444', padding: '14px', borderRadius: '12px' }}><Clock /></div>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '600' }}>Estancias Activas</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>{stats.activas}</p>
          </div>
        </div>

        <div className="stat-card" style={{ flex: 1, minWidth: '240px', background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '14px', borderRadius: '12px' }}><CalendarCheck /></div>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '600' }}>Total de Reservaciones</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>{stats.total}</p>
          </div>
        </div>
      </div>

      <div className="table-container" style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: '#0f172a' }}>
          <Users size={20} color="#0284c7" /> Flujo de Huéspedes en Tiempo Real
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
              <th style={{ padding: '12px', color: '#64748b' }}>Registro</th>
              <th style={{ padding: '12px', color: '#64748b' }}>Huésped</th>
              <th style={{ padding: '12px', color: '#64748b' }}>Hotel</th>
              <th style={{ padding: '12px', color: '#64748b' }}>Habitación</th>
              <th style={{ padding: '12px', color: '#64748b' }}>Estancia (Check-in 15h / Out 12h)</th>
              <th style={{ padding: '12px', color: '#64748b' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {reservas.map((res) => {
              const badge = badgeEstado(res.estado);
              return (
                <tr key={res.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
                    {res.fechaIngreso?.toDate ? res.fechaIngreso.toDate().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Reciente'}
                  </td>
                  <td style={{ padding: '12px', fontWeight: 'bold', color: '#0f172a' }}>{res.nombreUsuario}</td>
                  <td style={{ padding: '12px', color: '#0284c7', fontWeight: '600' }}>{mapaSucursales[res.idSucursal] || 'Hotel Registrado'}</td>
                  <td style={{ padding: '12px', fontWeight: '700' }}>#{res.numeroHabitacion} {res.tipoHabitacion ? `(${res.tipoHabitacion})` : ''}</td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>
                    {res.fechaEntrada && res.fechaSalida ? `${res.fechaEntrada} → ${res.fechaSalida}` : 'Estancia directa'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold',
                      background: badge.bg,
                      color: badge.color
                    }}>
                      {badge.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export default Dashboard;
