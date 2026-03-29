/**
 * Advanced Support and Resistance Zone Detector
 * Uses Pivot-based Clustering (The "gold standard" for professional indicators)
 * 
 * Logic:
 * 1. Find Structural Pivots (Fractals)
 * 2. Cluster pivots within a percentage threshold into Zones
 * 3. Track touches and identify S/R Flips (Polarity)
 */
export class AdvancedSRDetector {
  constructor(leftBars = 15, rightBars = 15, threshold = 0.005) {
    this.leftBars = leftBars;   // Strength of the pivot
    this.rightBars = rightBars; // Confirmation bars
    this.threshold = threshold; // Percentage-based clustering threshold (default 0.5%)
  }

  analyze(candles) {
    if (!candles || candles.length < this.leftBars + this.rightBars) return [];
    
    let pivots = [];

    // 1. Find Structural Pivots (Fractals)
    for (let i = this.leftBars; i < candles.length - this.rightBars; i++) {
      if (this.isPivotHigh(candles, i)) {
        pivots.push({ price: candles[i].high, time: candles[i].time, type: 'RES' });
      }
      if (this.isPivotLow(candles, i)) {
        pivots.push({ price: candles[i].low, time: candles[i].time, type: 'SUP' });
      }
    }

    // 2. Cluster into Zones (Price is rarely an exact number)
    let zones = [];
    for (let p of pivots) {
      let found = false;
      for (let z of zones) {
        // Clustering check: is the price within the threshold?
        if (Math.abs(z.price - p.price) / z.price <= this.threshold) {
          z.touches++;
          // Dynamic average: refine the zone's center price
          z.price = (z.price * (z.touches - 1) + p.price) / z.touches;
          
          // Track the timeframe of the zone
          if (p.time < z.startTime) z.startTime = p.time;
          
          // S/R Flip detection
          if (z.initialType !== p.type) z.isFlip = true;
          
          found = true;
          break;
        }
      }
      
      if (!found) {
        zones.push({ 
          price: p.price, 
          startTime: p.time,
          initialType: p.type, 
          touches: 1, 
          isFlip: false 
        });
      }
    }

    // 3. Filter significant zones (at least 2 touches) and sort by significance
    return zones
      .filter(z => z.touches >= 2)
      .sort((a, b) => b.touches - a.touches);
  }

  isPivotHigh(c, i) {
    for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
      if (c[j].high > c[i].high) return false;
    }
    return true;
  }

  isPivotLow(c, i) {
    for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
      if (c[j].low < c[i].low) return false;
    }
    return true;
  }
}
