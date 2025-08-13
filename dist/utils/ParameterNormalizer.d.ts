export declare class ParameterNormalizer {
    static normalizeDestinationName(destination: string): string;
    static normalizeSchemeName(schemeName: string): string;
    private static _capitalizeDeviceName;
    static findBestMatch(input: string, availableOptions: string[]): string | null;
    private static _calculateSimilarity;
    private static _levenshteinDistance;
}
//# sourceMappingURL=ParameterNormalizer.d.ts.map