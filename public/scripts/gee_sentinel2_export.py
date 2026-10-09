"""
Google Earth Engine - Exportador de Tiles XYZ Sentinel-2 (Livre de Nuvens)
Desenvolvido para integração com Leaflet e Geoportal GRAPROHAB SP.
Execute este script no Google Colab.
"""

import ee

# 1. Autenticação e Inicialização
print("Autenticando no Google Earth Engine...")
ee.Authenticate()

# Substitua pelo seu ID de projeto no Google Cloud
GEE_PROJECT_ID = "SEU_PROJECT_ID_AQUI"
ee.Initialize(project=GEE_PROJECT_ID)

# 2. Definição da Região de Interesse (Região Metropolitana de São Paulo e Interior)
# Formato: [min_lon, min_lat, max_lon, max_lat]
roi_sp = ee.Geometry.Rectangle([-47.25, -24.15, -45.95, -23.20])

# 3. Função de Máscara de Nuvens para Sentinel-2 Harmonized Surface Reflectance
def mask_s2_clouds(image):
    qa = image.select('QA60')
    cloud_bit_mask = 1 << 10
    cirrus_bit_mask = 1 << 11
    
    # Bits 10 e 11 devem ser zero
    mask_qa = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(
              qa.bitwiseAnd(cirrus_bit_mask).eq(0))
    
    # Scene Classification Layer (SCL)
    scl = image.select('SCL')
    # Remove: 3=sombra de nuvem, 8=nuvem média, 9=nuvem alta, 10=cirrus
    mask_scl = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10))
    
    # Escala para refletância de superfície [0, 1]
    return image.updateMask(mask_qa).updateMask(mask_scl).divide(10000)

# 4. Função para Composição Anual por Mediana
def get_annual_composite(year, roi):
    start_date = f"{year}-01-01"
    end_date = f"{year}-12-31"
    
    composite = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                 .filterBounds(roi)
                 .filterDate(start_date, end_date)
                 .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
                 .map(mask_s2_clouds)
                 .median()
                 .clip(roi))
    return composite

# 5. Parâmetros de Visualização (RGB Cor Verdadeira)
vis_params = {
    'bands': ['B4', 'B3', 'B2'],
    'min': 0.02,
    'max': 0.28,
    'gamma': 1.2
}

# 6. Geração dos Endpoints XYZ Dinâmicos
years = [2018, 2020, 2022]
print("\n" + "=" * 70)
print("GERANDO URLs DE TILES XYZ TEMPORÁRIAS DO GOOGLE EARTH ENGINE...")
print("=" * 70)

for yr in years:
    img = get_annual_composite(yr, roi_sp)
    map_id_dict = img.getMapId(vis_params)
    url_format = map_id_dict['tile_fetcher'].url_format
    print(f"\nANO {yr}:")
    print(url_format)

print("\n" + "=" * 70)
print("Copie as URLs acima e cole no Geoportal (Histórico Temporal > Configurar URLs GEE).")
print("=" * 70)
