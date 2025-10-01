import { useEffect, useState } from "react";

export default function useSymbols() {
  const [symbols, setSymbols] = useState([]);

  useEffect(() => {
    async function fetchSymbols() {
      const apiKey = import.meta.env.VITE_ALPHA_VANTAGE_KEY;
      const companies = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"];
      const results = [];

      for (const symbol of companies) {
        const res = await fetch(
          `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${symbol}&apikey=${apiKey}`
        );
        const data = await res.json();
        if (data.bestMatches?.[0]) {
          results.push({
            symbol: data.bestMatches[0]["1. symbol"],
            name: data.bestMatches[0]["2. name"],
            exchange: data.bestMatches[0]["4. region"], // or map to NASDAQ/NYSE
          });
        }
      }
      setSymbols(results);
    }
    fetchSymbols();
  }, []);

  return symbols;
}
