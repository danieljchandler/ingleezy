import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

interface SRSForecastChartProps {
  forecast: { date: string; label: string; count: number }[];
  className?: string;
}

export const SRSForecastChart = ({ forecast, className }: SRSForecastChartProps) => {
  return (
    <div className={cn("h-44", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={forecast}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} width={24} allowDecimals={false} />
          <Tooltip
            formatter={(value: number) => [`${value} cards`, "Due"]}
            labelFormatter={(label: string) => `${label}`}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {forecast.map((item, index) => (
              <Cell
                key={`${item.date}-${index}`}
                fill={index === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.45)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
