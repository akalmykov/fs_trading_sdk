import React, { useState, useEffect, useRef, useContext, useCallback, useId } from 'react';
import {
  generateGaussian,
  generateRange,
} from '@functionspace/core';
import { FunctionSpaceContext, useMarket, useBuy, usePreviewPayout } from '@functionspace/react';
import type { TradeInputBaseProps } from './types.js';
import { Slider } from '../components/Slider.js';
import { RangeSlider } from '../components/RangeSlider.js';
import '../styles/base.css';

export interface TradePanelProps extends TradeInputBaseProps {
  modes?: ('gaussian' | 'range')[];
  prediction?: number;
  confidence?: number;
  onPredictionChange?: (prediction: number) => void;
  onConfidenceChange?: (confidence: number) => void;
}

export function TradePanel({
  marketId,
  modes = ['gaussian', 'range'],
  prediction: controlledPrediction,
  confidence: controlledConfidence,
  onPredictionChange,
  onConfidenceChange,
  onBuy,
  onError,
}: TradePanelProps) {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('TradePanel must be used within FunctionSpaceProvider');

  const amountId = useId();
  const { market } = useMarket(marketId);
  const { execute: submitBuy, loading: isSubmitting, error: buyError } = useBuy(marketId);
  const { execute: previewPayout } = usePreviewPayout(marketId);

  const [activeMode, setActiveMode] = useState<'gaussian' | 'range'>(modes[0]);
  const [amount, setAmount] = useState('100');
  const [uncontrolledPrediction, setUncontrolledPrediction] = useState<number | null>(null);
  const [uncontrolledConfidence, setUncontrolledConfidence] = useState(50); // 0-100 percentage
  const [rangeValues, setRangeValues] = useState<[number, number] | null>(null);
  const [potentialPayout, setPotentialPayout] = useState<number | null>(null);

  const prediction = controlledPrediction ?? uncontrolledPrediction;
  const confidence = controlledConfidence ?? uncontrolledConfidence;

  const setPrediction = useCallback((value: number) => {
    if (controlledPrediction === undefined) {
      setUncontrolledPrediction(value);
    }
    onPredictionChange?.(value);
  }, [controlledPrediction, onPredictionChange]);

  const setConfidence = useCallback((value: number) => {
    if (controlledConfidence === undefined) {
      setUncontrolledConfidence(value);
    }
    onConfidenceChange?.(value);
  }, [controlledConfidence, onConfidenceChange]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Initialize slider values from market config
  useEffect(() => {
    if (market) {
      const { lowerBound, upperBound } = market.config;
      if (prediction === null) {
        setPrediction((lowerBound + upperBound) / 2);
      }
      if (rangeValues === null) {
        const range = upperBound - lowerBound;
        setRangeValues([lowerBound + range * 0.25, lowerBound + range * 0.75]);
      }
    }
  }, [market, prediction, rangeValues, setPrediction]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ctx.setPreviewBelief(null);
      ctx.setPreviewPayout(null);
    };
  }, []);

  // Convert confidence (0-100) to stdDev
  const getStdDevFromConfidence = useCallback((conf: number): number => {
    if (!market) return 4.0;
    const { lowerBound, upperBound } = market.config;
    const range = upperBound - lowerBound;
    const minSigma = range * 0.01;  // 1% of range (high confidence)
    const maxSigma = range * 0.20;  // 20% of range (low confidence)
    return maxSigma - ((conf / 100) * (maxSigma - minSigma));
  }, [market]);

  // Generate belief from current inputs
  const generateCurrentBelief = useCallback(() => {
    if (!market) return null;
    const { numBuckets, lowerBound, upperBound } = market.config;

    if (activeMode === 'gaussian') {
      if (prediction === null) return null;
      const stdDev = getStdDevFromConfidence(confidence);
      if (prediction < lowerBound || prediction > upperBound) return null;
      return generateGaussian(prediction, stdDev, numBuckets, lowerBound, upperBound);
    } else {
      if (!rangeValues) return null;
      const [lo, hi] = rangeValues;
      if (lo >= hi) return null;
      if (lo < lowerBound || hi > upperBound) return null;
      return generateRange(lo, hi, numBuckets, lowerBound, upperBound, 1);
    }
  }, [market, activeMode, prediction, confidence, rangeValues, getStdDevFromConfidence]);

  // Instant preview update (no debounce)
  useEffect(() => {
    const belief = generateCurrentBelief();
    ctx.setPreviewBelief(belief);

    if (!belief) {
      setPotentialPayout(null);
      ctx.setPreviewPayout(null);
    }
  }, [generateCurrentBelief]);

  // Debounced payout preview
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const belief = generateCurrentBelief();
    const collateral = parseFloat(amount);
    if (!belief || isNaN(collateral) || collateral <= 0 || !market) {
      setPotentialPayout(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await previewPayout(belief, collateral);
        if (!mountedRef.current) return;
        setPotentialPayout(result.maxPayout);
        ctx.setPreviewPayout(result);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!mountedRef.current) return;
        setPotentialPayout(null);
        ctx.setPreviewPayout(null);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [generateCurrentBelief, amount, market, marketId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const belief = generateCurrentBelief();
    const collateral = parseFloat(amount);
    if (!belief || isNaN(collateral) || collateral < 1) return;

    try {
      const result = await submitBuy(belief, collateral);

      // Reset to defaults
      if (market) {
        const { lowerBound, upperBound } = market.config;
        setPrediction((lowerBound + upperBound) / 2);
        setConfidence(50);
        const range = upperBound - lowerBound;
        setRangeValues([lowerBound + range * 0.25, lowerBound + range * 0.75]);
      }
      setAmount('100');
      setPotentialPayout(null);
      ctx.setPreviewBelief(null);
      ctx.setPreviewPayout(null);

      onBuy?.(result);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const isFormValid = (() => {
    const collateral = parseFloat(amount);
    if (isNaN(collateral) || collateral < 1) return false;
    return generateCurrentBelief() !== null;
  })();

  const showTabs = modes.length > 1;

  // Calculate step based on market range
  const getStep = () => {
    if (!market) return 1;
    const range = market.config.upperBound - market.config.lowerBound;
    return range / 100;
  };

  return (
    <div className="fs-trade-panel">
      <div className="fs-trade-header">
        <h3>Submit Trade</h3>
        <p>Enter your position</p>
      </div>

      {showTabs && (
        <div className="fs-tabs">
          {modes.map((mode) => (
            <button
              key={mode}
              className={`fs-tab ${activeMode === mode ? 'active' : ''}`}
              onClick={() => setActiveMode(mode)}
              type="button"
            >
              {mode === 'gaussian' ? 'Gaussian' : 'Range'}
            </button>
          ))}
        </div>
      )}

      <form className="fs-trade-form" onSubmit={handleSubmit}>
        <div className="fs-input-group">
          <label htmlFor={amountId}>Amount (USDC)</label>
          <input
            id={amountId}
            type="number"
            step="0.01"
            min="1"
            placeholder="100.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="fs-input-hint">Minimum: 1.00 USDC</span>
        </div>

        {activeMode === 'gaussian' ? (
          <>
            <div className="fs-slider-group">
              <div className="fs-slider-header">
                <span className="fs-slider-label">My Prediction</span>
                {market && prediction !== null && (
                  <span className="fs-slider-value">{prediction.toFixed(1)}</span>
                )}
              </div>
              {market && prediction !== null && (
                <>
                  <Slider
                    min={market.config.lowerBound}
                    max={market.config.upperBound}
                    value={prediction}
                    onChange={setPrediction}
                    step={getStep()}
                    disabled={isSubmitting}
                  />
                  <div className="fs-slider-bounds">
                    <span>{market.config.lowerBound}</span>
                    <span>{market.config.upperBound}</span>
                  </div>
                </>
              )}
            </div>
            <div className="fs-slider-group">
              <div className="fs-slider-header">
                <span className="fs-slider-label">Confidence</span>
                <span className="fs-slider-value">{confidence}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                value={confidence}
                onChange={setConfidence}
                step={1}
                disabled={isSubmitting}
              />
              <div className="fs-slider-bounds">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>
          </>
        ) : (
          <div className="fs-slider-group">
            <div className="fs-slider-header">
              <span className="fs-slider-label">Select Range</span>
            </div>
            {market && rangeValues && (
              <>
                <RangeSlider
                  min={market.config.lowerBound}
                  max={market.config.upperBound}
                  values={rangeValues}
                  onChange={setRangeValues}
                  step={getStep()}
                  disabled={isSubmitting}
                />
                <div className="fs-range-values">
                  <span className="fs-range-value">{rangeValues[0].toFixed(1)}</span>
                  <span className="fs-range-separator">to</span>
                  <span className="fs-range-value">{rangeValues[1].toFixed(1)}</span>
                </div>
                <div className="fs-slider-bounds">
                  <span>{market.config.lowerBound}</span>
                  <span>{market.config.upperBound}</span>
                </div>
              </>
            )}
          </div>
        )}

        <div className="fs-payout-box">
          <span className="fs-payout-label">Potential Payout</span>
          <span className={`fs-payout-value ${potentialPayout !== null ? 'has-value' : 'no-value'}`}>
            {potentialPayout !== null ? `$${potentialPayout.toFixed(2)}` : '--'}
          </span>
          <p className="fs-payout-hint">
            This is your payout if the market settles at your exact prediction.
          </p>
        </div>

        {buyError && <div className="fs-error-box">{buyError.message}</div>}

        <button
          type="submit"
          className="fs-submit-btn"
          disabled={!isFormValid || isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Trade'}
        </button>
      </form>
    </div>
  );
}
