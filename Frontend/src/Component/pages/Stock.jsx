// src/Component/pages/Stock.jsx
import { useParams } from 'react-router-dom';
import TradingView from './TradingView';

export default function Stock() {
  const { symbol } = useParams();

  return (
    <div className="min-h-screen">
      <TradingView />
    </div>
  );
}